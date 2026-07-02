import { Controller, Get } from '@nestjs/common'
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
    queue: ComponentHealth
  }
  metrics: {
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
    private readonly prisma: PrismaService,
    @InjectQueue('probe') private readonly probeQueue: Queue,
  ) {}

  @Get()
  async getHealth(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString()
    const uptime = Date.now() - this.startTime

    const [database, redis, queue] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueue(),
    ])

    const components = { database, redis, queue }
    const status = this.determineOverallStatus(components)

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

  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now()
    try {
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
