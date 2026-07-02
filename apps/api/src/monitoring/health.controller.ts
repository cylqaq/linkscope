import { Controller, Get } from '@nestjs/common'
import { MetricsService } from './metrics.service'
import { BrowserPoolService } from '../probe/browser-pool.service'
import { PrismaService } from '../prisma/prisma.service'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  version: string
  uptime: number
  components: {
    database: ComponentHealth
    redis: ComponentHealth
    browserPool: ComponentHealth
    queue: ComponentHealth
  }
  metrics: {
    totalBrowsers: number
    totalContexts: number
    availableBrowsers: number
    queueWaiting: number
    queueActive: number
  }
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
  latencyMs?: number
}

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now()

  constructor(
    private readonly metricsService: MetricsService,
    private readonly browserPoolService: BrowserPoolService,
    private readonly prisma: PrismaService,
    @InjectQueue('probe') private readonly probeQueue: Queue,
  ) {}

  @Get()
  async getHealth(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString()
    const uptime = Date.now() - this.startTime

    // 并行检查各组件状态
    const [database, redis, queue] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueue(),
    ])
    const browserPool = this.checkBrowserPool()

    // 确定整体状态
    const components = { database, redis, browserPool, queue }
    const status = this.determineOverallStatus(components)

    // 获取浏览器池状态
    const poolStatus = this.browserPoolService.getPoolStatus()

    // 获取队列状态
    const [waiting, active] = await Promise.all([
      this.probeQueue.getWaitingCount(),
      this.probeQueue.getActiveCount(),
    ])

    return {
      status,
      timestamp,
      version: process.env.npm_package_version || '1.0.0',
      uptime,
      components,
      metrics: {
        totalBrowsers: poolStatus.totalBrowsers,
        totalContexts: poolStatus.totalContexts,
        availableBrowsers: poolStatus.availableBrowsers,
        queueWaiting: waiting,
        queueActive: active,
      },
    }
  }

  @Get('ready')
  async getReadiness(): Promise<{ ready: boolean; message: string }> {
    const health = await this.getHealth()
    
    if (health.status === 'unhealthy') {
      return {
        ready: false,
        message: 'Service is unhealthy',
      }
    }

    return {
      ready: true,
      message: 'Service is ready',
    }
  }

  @Get('live')
  getLiveness(): { alive: boolean; timestamp: string } {
    return {
      alive: true,
      timestamp: new Date().toISOString(),
    }
  }

  @Get('metrics')
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics()
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now()
    try {
      // 执行简单查询测试数据库连接
      await this.prisma.$queryRaw`SELECT 1`
      return {
        status: 'healthy',
        message: 'Database connection is healthy',
        latencyMs: Date.now() - start,
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database error: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - start,
      }
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    const start = Date.now()
    try {
      // 通过 Bull 队列检查 Redis 连接
      const client = this.probeQueue.client
      await client.ping()
      return {
        status: 'healthy',
        message: 'Redis connection is healthy',
        latencyMs: Date.now() - start,
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Redis error: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - start,
      }
    }
  }

  private checkBrowserPool(): ComponentHealth {
    try {
      const poolStatus = this.browserPoolService.getPoolStatus()
      
      if (poolStatus.totalBrowsers === 0) {
        return {
          status: 'degraded',
          message: 'No browser instances initialized',
        }
      }

      if (poolStatus.availableBrowsers === 0) {
        return {
          status: 'degraded',
          message: 'No available browser instances',
        }
      }

      return {
        status: 'healthy',
        message: `Browser pool has ${poolStatus.availableBrowsers} available instances`,
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Browser pool error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  private async checkQueue(): Promise<ComponentHealth> {
    try {
      const [waiting, active, failed] = await Promise.all([
        this.probeQueue.getWaitingCount(),
        this.probeQueue.getActiveCount(),
        this.probeQueue.getFailedCount(),
      ])

      if (failed > 100) {
        return {
          status: 'degraded',
          message: `Queue has ${failed} failed jobs`,
        }
      }

      return {
        status: 'healthy',
        message: `Queue: ${waiting} waiting, ${active} active, ${failed} failed`,
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Queue error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  private determineOverallStatus(components: Record<string, ComponentHealth>): 'healthy' | 'degraded' | 'unhealthy' {
    const statuses = Object.values(components).map(c => c.status)
    
    if (statuses.includes('unhealthy')) {
      return 'unhealthy'
    }
    
    if (statuses.includes('degraded')) {
      return 'degraded'
    }
    
    return 'healthy'
  }
}
