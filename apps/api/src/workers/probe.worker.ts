import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { PrismaService } from '../prisma/prisma.service'
import { HttpProbeService } from '../probe/http-probe.service'
import { BrowserProbeService } from '../probe/browser-probe.service'
import { ClassifyService } from '../classify/classify.service'
import { TasksService } from '../tasks/tasks.service'

interface ProbeJobData {
  taskId: string
  taskUrlId: string
}

@Processor('probe')
export class ProbeWorker {
  private readonly logger = new Logger(ProbeWorker.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpProbe: HttpProbeService,
    private readonly browserProbe: BrowserProbeService,
    private readonly classify: ClassifyService,
    private readonly tasksService: TasksService,
  ) {}

  @Process({ name: 'probe-url', concurrency: 10 })
  async handleProbe(job: Job<ProbeJobData>) {
    const { taskId, taskUrlId } = job.data

    try {
      // Mark as probing
      const taskUrl = await this.prisma.taskUrl.update({
        where: { id: taskUrlId },
        data: { status: 'probing' },
      })

      const url = taskUrl.normalizedUrl
      this.logger.debug(`Probing: ${url}`)

      // L1: HTTP probe
      const httpResult = await this.httpProbe.probe(url)

      await this.prisma.httpProbe.upsert({
        where: { taskUrlId },
        create: {
          taskUrlId,
          statusCode: httpResult.statusCode,
          finalUrl: httpResult.finalUrl,
          redirectChain: httpResult.redirectChain,
          latencyMs: httpResult.latencyMs,
          errorCode: httpResult.errorCode,
          headFailed: httpResult.headFailed,
        },
        update: {
          statusCode: httpResult.statusCode,
          finalUrl: httpResult.finalUrl,
          redirectChain: httpResult.redirectChain,
          latencyMs: httpResult.latencyMs,
          errorCode: httpResult.errorCode,
        },
      })

      // L2: Browser probe (if needed)
      let browserResult = null
      if (this.httpProbe.shouldTriggerBrowserFallback(url, httpResult)) {
        try {
          browserResult = await this.browserProbe.probe(url, taskUrlId)

          await this.prisma.browserProbe.upsert({
            where: { taskUrlId },
            create: {
              taskUrlId,
              pageTitle: browserResult.pageTitle,
              pageText: browserResult.pageText,
              finalUrl: browserResult.finalUrl,
              screenshotPath: browserResult.screenshotPath,
              domSignals: browserResult.domSignals as any,
              errorCode: browserResult.errorCode,
            },
            update: {
              pageTitle: browserResult.pageTitle,
              pageText: browserResult.pageText,
              finalUrl: browserResult.finalUrl,
              screenshotPath: browserResult.screenshotPath,
              domSignals: browserResult.domSignals as any,
            },
          })
        } catch (browserErr) {
          this.logger.warn(`Browser probe failed for ${url}: ${browserErr}`)
        }
      }

      // L3/AI: Classification
      const classification = await this.classify.classify(taskUrlId, url, httpResult, browserResult)

      await this.prisma.classification.upsert({
        where: { taskUrlId },
        create: {
          taskUrlId,
          finalStatus: classification.finalStatus,
          internalStatus: classification.internalStatus,
          reasonCode: classification.reasonCode,
          confidence: classification.confidence,
          sourceOfTruth: classification.sourceOfTruth,
          retryStrategy: classification.retryStrategy,
          needsReview: classification.needsReview,
          evidence: classification.evidence as any,
        },
        update: {
          finalStatus: classification.finalStatus,
          internalStatus: classification.internalStatus,
          reasonCode: classification.reasonCode,
          confidence: classification.confidence,
          sourceOfTruth: classification.sourceOfTruth,
          retryStrategy: classification.retryStrategy,
          needsReview: classification.needsReview,
          evidence: classification.evidence as any,
        },
      })

      // Mark URL as completed
      await this.prisma.taskUrl.update({
        where: { id: taskUrlId },
        data: { status: 'completed', completedAt: new Date() },
      })

      // Update task counters
      await this.tasksService.incrementCompleted(taskId, classification.finalStatus)

      this.logger.debug(`Done: ${url} → ${classification.finalStatus} (${classification.reasonCode})`)
    } catch (err: any) {
      this.logger.error(`Probe failed for ${taskUrlId}: ${err?.message}`)

      await this.prisma.taskUrl.update({
        where: { id: taskUrlId },
        data: { status: 'failed' },
      }).catch(() => {})

      await this.tasksService.incrementCompleted(taskId, 'review_required').catch(() => {})
      throw err
    }
  }
}
