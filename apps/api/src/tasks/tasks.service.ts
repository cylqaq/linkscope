import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import * as fs from 'fs'
import * as path from 'path'
import { PrismaService } from '../prisma/prisma.service'
import { resolveScreenshotStorageDir } from '../screenshot-storage'
import { normalizeUrl, dedupeKey, extractUrlsFromText, isValidUrl, detectPlatform } from '@linkscope/shared'

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('probe') private readonly probeQueue: Queue,
  ) {}

  async createTask(urls: string[], name?: string) {
    // Normalize & dedupe
    const normalized: { original: string; normalized: string; domain: string; platform: string; dedupe: string }[] = []
    const seen = new Set<string>()

    for (const raw of urls) {
      const norm = normalizeUrl(raw.trim())
      if (!norm || !isValidUrl(norm)) continue
      const dk = dedupeKey(norm)
      if (seen.has(dk)) continue
      seen.add(dk)

      const parsed = new URL(norm)
      const domain = parsed.hostname.replace(/^www\./, '')
      const platformConfig = detectPlatform(norm)

      normalized.push({
        original: raw.trim(),
        normalized: norm,
        domain,
        platform: platformConfig?.id ?? 'generic',
        dedupe: dk,
      })
    }

    if (normalized.length === 0) {
      throw new Error('No valid URLs found')
    }

    const task = await this.prisma.task.create({
      data: {
        name: name ?? `任务 ${new Date().toLocaleString('zh-CN')}`,
        totalUrls: normalized.length,
        status: 'queued',
        taskUrls: {
          create: normalized.map(u => ({
            originalUrl: u.original,
            normalizedUrl: u.normalized,
            domain: u.domain,
            platform: u.platform,
            dedupeKey: u.dedupe,
          })),
        },
      },
      include: { taskUrls: { select: { id: true } } },
    })

    // Enqueue all URLs for probing
    const jobs = task.taskUrls.map(u => ({
      name: 'probe-url',
      data: { taskId: task.id, taskUrlId: u.id },
    }))

    await this.probeQueue.addBulk(
      jobs.map(j => ({
        name: j.name,
        data: j.data,
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100 },
      }))
    )

    // Update status to running
    await this.prisma.task.update({ where: { id: task.id }, data: { status: 'running' } })

    return this.getTaskById(task.id)
  }

  async createTaskFromText(text: string, name?: string) {
    const urls = extractUrlsFromText(text)
    return this.createTask(urls, name)
  }

  async getTaskById(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } })
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  async listTasks(page = 1, pageSize = 20) {
    const [total, items] = await Promise.all([
      this.prisma.task.count(),
      this.prisma.task.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return { total, page, pageSize, items }
  }

  async getTaskResults(taskId: string, options: {
    page?: number
    pageSize?: number
    finalStatus?: string
    platform?: string
    reasonCode?: string
  }) {
    const { page = 1, pageSize = 50, finalStatus, platform, reasonCode } = options

    const where = {
      taskId,
      ...(finalStatus || platform || reasonCode ? {
        classification: {
          ...(finalStatus ? { finalStatus } : {}),
          ...(reasonCode ? { reasonCode } : {}),
        },
        ...(platform ? { platform } : {}),
      } : {}),
    }

    const [total, items] = await Promise.all([
      this.prisma.taskUrl.count({ where }),
      this.prisma.taskUrl.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          httpProbe: true,
          browserProbe: {
            select: {
              pageTitle: true,
              finalUrl: true,
              screenshotPath: true,
              errorCode: true,
              domSignals: true,
              networkSamples: true,
            },
          },
          classification: true,
          aiJudgement: { select: { decision: true, confidence: true, reasoning: true, modelName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    return { total, page, pageSize, items }
  }

  async incrementCompleted(taskId: string, finalStatus: string) {
    const inc = {
      completedUrls: { increment: 1 },
      ...(finalStatus === 'accessible' ? { accessibleCount: { increment: 1 } } : {}),
      ...(finalStatus === 'dead_link' ? { deadLinkCount: { increment: 1 } } : {}),
      ...(finalStatus === 'review_required' ? { reviewCount: { increment: 1 } } : {}),
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: inc,
    })

    // Mark completed if all done
    if (task.completedUrls >= task.totalUrls) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'completed', completedAt: new Date() },
      })
    }
  }

  /**
   * L2 截图：仅允许读取 `{SCREENSHOT_DIR}/{taskUrlId}.jpg`，且该 URL 须属于 taskId（防路径穿越与越权）。
   */
  async getScreenshotAbsolutePath(taskId: string, taskUrlId: string): Promise<string | null> {
    const row = await this.prisma.taskUrl.findFirst({
      where: { id: taskUrlId, taskId },
      select: { browserProbe: { select: { screenshotPath: true } } },
    })
    if (!row?.browserProbe?.screenshotPath) return null

    const dir = resolveScreenshotStorageDir()
    const filePath = path.resolve(dir, `${taskUrlId}.jpg`)
    if (!filePath.startsWith(dir + path.sep)) return null
    if (!fs.existsSync(filePath)) return null
    return filePath
  }
}
