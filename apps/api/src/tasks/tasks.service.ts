import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import * as fs from 'fs'
import * as path from 'path'
import { PrismaService } from '../prisma/prisma.service'
import { resolveScreenshotStorageDir } from '../screenshot-storage'
import { normalizeUrl, dedupeKey, extractUrlsFromText, isValidUrl, detectPlatform } from '@linkscope/shared'
import { FileParserService, ParsedUrl, FileParseResult } from './file-parser.service'

const BATCH_SIZE = 500 // 数据库批量插入大小
const QUEUE_BATCH_SIZE = 100 // 队列批量添加大小

export interface TaskCreationProgress {
  phase: 'parsing' | 'inserting' | 'queuing' | 'completed'
  total: number
  processed: number
  percentage: number
  message: string
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('probe') private readonly probeQueue: Queue,
    private readonly fileParser: FileParserService,
  ) {}

  /**
   * 从文本创建任务（支持大文本）
   */
  async createTask(urls: string[], name?: string) {
    // 规范化和去重
    const normalized: ParsedUrl[] = []
    const seen = new Set<string>()

    for (let i = 0; i < urls.length; i++) {
      const raw = urls[i].trim()
      const norm = normalizeUrl(raw)
      if (!norm || !isValidUrl(norm)) continue
      const dk = dedupeKey(norm)
      if (seen.has(dk)) continue
      seen.add(dk)

      const parsed = new URL(norm)
      const domain = parsed.hostname.replace(/^www\./, '')
      const platformConfig = detectPlatform(norm)

      normalized.push({
        original: raw,
        normalized: norm,
        domain,
        platform: platformConfig?.id ?? 'generic',
        dedupe: dk,
        rowNumber: i + 1,
      })
    }

    if (normalized.length === 0) {
      throw new Error('No valid URLs found')
    }

    return this.createTaskFromParsedUrls(normalized, name)
  }

  /**
   * 从文本创建任务
   */
  async createTaskFromText(text: string, name?: string) {
    const urls = extractUrlsFromText(text)
    return this.createTask(urls, name)
  }

  /**
   * 从文件创建任务（支持万级数据量）
   */
  async createTaskFromFile(
    file: Express.Multer.File,
    name?: string,
    onProgress?: (progress: TaskCreationProgress) => void,
  ) {
    // 1. 解析文件
    onProgress?.({
      phase: 'parsing',
      total: 0,
      processed: 0,
      percentage: 0,
      message: '正在解析文件...',
    })

    const parseResult = await this.fileParser.parseFile(file, (progress) => {
      onProgress?.({
        phase: 'parsing',
        total: progress.totalRows,
        processed: progress.parsedRows,
        percentage: Math.round((progress.parsedRows / progress.totalRows) * 100),
        message: `正在解析: ${progress.parsedRows}/${progress.totalRows} 行`,
      })
    })

    if (parseResult.urls.length === 0) {
      throw new Error('文件中未找到有效URL')
    }

    // 2. 创建任务
    onProgress?.({
      phase: 'inserting',
      total: parseResult.urls.length,
      processed: 0,
      percentage: 0,
      message: `正在创建任务，共 ${parseResult.urls.length} 个URL...`,
    })

    const task = await this.createTaskFromParsedUrls(parseResult.urls, name, onProgress)

    return {
      task,
      parseStats: parseResult.stats,
    }
  }

  /**
   * 从已解析的URL创建任务（批量插入优化）
   */
  private async createTaskFromParsedUrls(
    urls: ParsedUrl[],
    name?: string,
    onProgress?: (progress: TaskCreationProgress) => void,
  ) {
    // 创建任务记录
    const task = await this.prisma.task.create({
      data: {
        name: name ?? `任务 ${new Date().toLocaleString('zh-CN')}`,
        totalUrls: urls.length,
        status: 'queued',
      },
    })

    // 分批插入TaskUrls
    const totalBatches = Math.ceil(urls.length / BATCH_SIZE)
    let insertedCount = 0

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1

      await this.prisma.taskUrl.createMany({
        data: batch.map(u => ({
          taskId: task.id,
          originalUrl: u.original,
          normalizedUrl: u.normalized,
          domain: u.domain,
          platform: u.platform,
          dedupeKey: u.dedupe,
        })),
        skipDuplicates: true,
      })

      insertedCount += batch.length
      onProgress?.({
        phase: 'inserting',
        total: urls.length,
        processed: insertedCount,
        percentage: Math.round((insertedCount / urls.length) * 100),
        message: `正在插入数据库: ${insertedCount}/${urls.length} (${batchNumber}/${totalBatches}批)`,
      })
    }

    // 获取所有TaskUrl的ID
    const taskUrls = await this.prisma.taskUrl.findMany({
      where: { taskId: task.id },
      select: { id: true, domain: true },
    })

    // 分批添加到队列
    onProgress?.({
      phase: 'queuing',
      total: taskUrls.length,
      processed: 0,
      percentage: 0,
      message: `正在添加到检测队列...`,
    })

    let queuedCount = 0
    for (let i = 0; i < taskUrls.length; i += QUEUE_BATCH_SIZE) {
      const batch = taskUrls.slice(i, i + QUEUE_BATCH_SIZE)
      const jobs = batch.map(u => ({
        name: 'probe-url',
        data: { taskId: task.id, taskUrlId: u.id },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          // 优先级：国内平台优先
          priority: this.getDomainPriority(u.domain),
        },
      }))

      await this.probeQueue.addBulk(jobs)
      queuedCount += batch.length

      onProgress?.({
        phase: 'queuing',
        total: taskUrls.length,
        processed: queuedCount,
        percentage: Math.round((queuedCount / taskUrls.length) * 100),
        message: `正在添加到检测队列: ${queuedCount}/${taskUrls.length}`,
      })
    }

    // 更新任务状态
    await this.prisma.task.update({
      where: { id: task.id },
      data: { status: 'running' },
    })

    onProgress?.({
      phase: 'completed',
      total: urls.length,
      processed: urls.length,
      percentage: 100,
      message: `任务创建完成，共 ${urls.length} 个URL`,
    })

    return this.getTaskById(task.id)
  }

  /**
   * 获取域名优先级（国内平台优先）
   */
  private getDomainPriority(domain: string): number {
    const highPriorityDomains = [
      'douyin.com',
      'kuaishou.com',
      'xiaohongshu.com',
      'bilibili.com',
      'weibo.com',
    ]

    for (const d of highPriorityDomains) {
      if (domain.includes(d)) return 1
    }
    return 5
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

  /**
   * 获取任务统计信息
   */
  async getTaskStats(taskId: string) {
    const task = await this.getTaskById(taskId)
    const domainStats = await this.prisma.taskUrl.groupBy({
      by: ['platform'],
      where: { taskId },
      _count: { id: true },
    })

    const statusStats = await this.prisma.taskUrl.groupBy({
      by: ['status'],
      where: { taskId },
      _count: { id: true },
    })

    return {
      task,
      byPlatform: domainStats.map(d => ({
        platform: d.platform,
        count: d._count.id,
      })),
      byStatus: statusStats.map(s => ({
        status: s.status,
        count: s._count.id,
      })),
    }
  }
}
