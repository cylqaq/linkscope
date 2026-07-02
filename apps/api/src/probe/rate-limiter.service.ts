import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

interface DomainBucket {
  tokens: number
  lastRefill: number
  queue: Array<{ resolve: () => void; timestamp: number }>
}

export interface RateLimiterConfig {
  /** 每域名每秒最大请求数 */
  requestsPerSecond: number
  /** 每域名最大并发数 */
  maxConcurrent: number
  /** 突发请求容量 */
  burstCapacity: number
  /** 清理空闲桶的间隔（毫秒） */
  cleanupIntervalMs: number
  /** 桶空闲超时时间（毫秒） */
  bucketIdleTimeoutMs: number
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name)
  private readonly buckets = new Map<string, DomainBucket>()
  private readonly activeCounts = new Map<string, number>()
  private readonly config: RateLimiterConfig
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(private readonly configService: ConfigService) {
    this.config = {
      requestsPerSecond: this.configService.get<number>('RATE_LIMIT_PER_DOMAIN', 2),
      maxConcurrent: this.configService.get<number>('RATE_LIMIT_MAX_CONCURRENT', 5),
      burstCapacity: this.configService.get<number>('RATE_LIMIT_BURST_CAPACITY', 10),
      cleanupIntervalMs: this.configService.get<number>('RATE_LIMIT_CLEANUP_INTERVAL', 60000),
      bucketIdleTimeoutMs: this.configService.get<number>('RATE_LIMIT_BUCKET_IDLE_TIMEOUT', 300000),
    }

    this.logger.log('RateLimiter config loaded', this.config)
    this.startCleanupTimer()
  }

  /**
   * 获取域名的请求许可
   * 如果超过限速，会等待直到可以发送
   */
  async acquire(domain: string): Promise<() => void> {
    const bucket = this.getOrCreateBucket(domain)

    // 检查并发限制
    await this.waitForConcurrentSlot(domain)

    // 等待令牌
    await this.waitForToken(bucket, domain)

    // 增加活跃计数
    this.activeCounts.set(domain, (this.activeCounts.get(domain) || 0) + 1)

    // 返回释放函数
    return () => this.release(domain)
  }

  /**
   * 尝试获取许可（非阻塞）
   * 如果无法获取，返回null
   */
  tryAcquire(domain: string): (() => void) | null {
    const bucket = this.getOrCreateBucket(domain)

    // 检查并发限制
    const activeCount = this.activeCounts.get(domain) || 0
    if (activeCount >= this.config.maxConcurrent) {
      return null
    }

    // 检查令牌
    this.refillTokens(bucket)
    if (bucket.tokens < 1) {
      return null
    }

    // 消耗令牌
    bucket.tokens -= 1
    this.activeCounts.set(domain, activeCount + 1)

    return () => this.release(domain)
  }

  /**
   * 释放域名的并发槽
   */
  private release(domain: string): void {
    const count = this.activeCounts.get(domain) || 0
    if (count > 0) {
      this.activeCounts.set(domain, count - 1)
    }
  }

  /**
   * 等待并发槽
   */
  private async waitForConcurrentSlot(domain: string): Promise<void> {
    const maxRetries = 60 // 最多等待60秒
    let retries = 0

    while (retries < maxRetries) {
      const activeCount = this.activeCounts.get(domain) || 0
      if (activeCount < this.config.maxConcurrent) {
        return
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
      retries++
    }

    this.logger.warn(`等待并发槽超时: ${domain}`)
  }

  /**
   * 等待令牌
   */
  private async waitForToken(bucket: DomainBucket, domain: string): Promise<void> {
    const maxWaitMs = 30000 // 最多等待30秒
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitMs) {
      this.refillTokens(bucket)

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        return
      }

      // 计算需要等待的时间
      const waitTime = Math.ceil(1000 / this.config.requestsPerSecond)
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    this.logger.warn(`等待令牌超时: ${domain}`)
    // 超时后强制允许请求
    bucket.tokens = Math.max(0, bucket.tokens - 1)
  }

  /**
   * 补充令牌
   */
  private refillTokens(bucket: DomainBucket): void {
    const now = Date.now()
    const timePassed = now - bucket.lastRefill
    const tokensToAdd = (timePassed / 1000) * this.config.requestsPerSecond

    bucket.tokens = Math.min(this.config.burstCapacity, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now
  }

  /**
   * 获取或创建域名桶
   */
  private getOrCreateBucket(domain: string): DomainBucket {
    let bucket = this.buckets.get(domain)
    if (!bucket) {
      bucket = {
        tokens: this.config.burstCapacity,
        lastRefill: Date.now(),
        queue: [],
      }
      this.buckets.set(domain, bucket)
    }
    return bucket
  }

  /**
   * 获取域名的当前状态
   */
  getDomainStatus(domain: string): {
    activeRequests: number
    availableTokens: number
    queueLength: number
  } {
    const bucket = this.buckets.get(domain)
    const activeRequests = this.activeCounts.get(domain) || 0

    if (!bucket) {
      return {
        activeRequests,
        availableTokens: this.config.burstCapacity,
        queueLength: 0,
      }
    }

    this.refillTokens(bucket)

    return {
      activeRequests,
      availableTokens: Math.floor(bucket.tokens),
      queueLength: bucket.queue.length,
    }
  }

  /**
   * 获取所有域名的状态
   */
  getAllDomainStatus(): Record<string, ReturnType<typeof this.getDomainStatus>> {
    const status: Record<string, ReturnType<typeof this.getDomainStatus>> = {}
    const domains = new Set([...this.buckets.keys(), ...this.activeCounts.keys()])

    for (const domain of domains) {
      status[domain] = this.getDomainStatus(domain)
    }

    return status
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleBuckets()
    }, this.config.cleanupIntervalMs)
  }

  /**
   * 清理空闲桶
   */
  private cleanupIdleBuckets(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [domain, bucket] of this.buckets) {
      const activeCount = this.activeCounts.get(domain) || 0
      const idleTime = now - bucket.lastRefill

      if (activeCount === 0 && idleTime > this.config.bucketIdleTimeoutMs) {
        this.buckets.delete(domain)
        this.activeCounts.delete(domain)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} idle rate limiter buckets`)
    }
  }

  /**
   * 销毁服务时清理资源
   */
  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
  }
}
