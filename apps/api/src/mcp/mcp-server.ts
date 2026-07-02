import { Injectable, Logger } from '@nestjs/common'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { TasksService } from '../tasks/tasks.service'
import { ExportService } from '../export/export.service'
import { HttpProbeService } from '../probe/http-probe.service'
import { BrowserProbeService } from '../probe/browser-probe.service'
import { ScreenHintsService } from '../screen-hints/screen-hints.service'
import { detectPlatform, PLATFORM_CONFIGS, stripTrackingParams } from '@linkscope/shared'
import type { FinalStatus, ClassificationResult } from '@linkscope/shared'

// 工具输入验证 Schema
const DetectLinkStatusSchema = z.object({
  url: z.string().url(),
  options: z.object({
    skipBrowser: z.boolean().optional(),
    skipAi: z.boolean().optional(),
    platform: z.string().optional(),
  }).optional(),
})

const BatchDetectSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(100),
  options: z.object({
    skipBrowser: z.boolean().optional(),
    skipAi: z.boolean().optional(),
    concurrency: z.number().min(1).max(10).optional(),
  }).optional(),
})

const GetTaskResultsSchema = z.object({
  taskId: z.string(),
})

const ExportResultsSchema = z.object({
  taskId: z.string(),
  format: z.enum(['json', 'csv', 'excel']),
})

@Injectable()
export class LinkScopeMcpServer {
  private readonly logger = new Logger(LinkScopeMcpServer.name)
  private server: Server

  constructor(
    private readonly tasksService: TasksService,
    private readonly exportService: ExportService,
    private readonly httpProbeService: HttpProbeService,
    private readonly browserProbeService: BrowserProbeService,
    private readonly screenHintsService: ScreenHintsService,
  ) {
    this.server = new Server(
      {
        name: 'linkscope',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    )

    this.setupHandlers()
  }

  private setupHandlers() {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'detect_link_status',
          description: '检测单个链接的状态，返回可访问性判定和证据',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '要检测的URL' },
              options: {
                type: 'object',
                properties: {
                  skipBrowser: { type: 'boolean', description: '跳过浏览器探测' },
                  skipAi: { type: 'boolean', description: '跳过AI判定' },
                  platform: { type: 'string', description: '指定平台' },
                },
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'batch_detect',
          description: '批量检测链接状态，支持并发控制',
          inputSchema: {
            type: 'object',
            properties: {
              urls: {
                type: 'array',
                items: { type: 'string' },
                description: '要检测的URL列表',
              },
              options: {
                type: 'object',
                properties: {
                  skipBrowser: { type: 'boolean', description: '跳过浏览器探测' },
                  skipAi: { type: 'boolean', description: '跳过AI判定' },
                  concurrency: { type: 'number', description: '并发数' },
                },
              },
            },
            required: ['urls'],
          },
        },
        {
          name: 'get_task_results',
          description: '获取任务的检测结果',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: '任务ID' },
            },
            required: ['taskId'],
          },
        },
        {
          name: 'export_results',
          description: '导出任务结果为指定格式',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: '任务ID' },
              format: {
                type: 'string',
                enum: ['json', 'csv', 'excel'],
                description: '导出格式',
              },
            },
            required: ['taskId', 'format'],
          },
        },
      ],
    }))

    // 列出可用资源
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'linkscope://platforms',
          name: 'platform_configs',
          description: '平台配置列表，包含支持的社交媒体和短视频平台',
          mimeType: 'application/json',
        },
        {
          uri: 'linkscope://history',
          name: 'detection_history',
          description: '检测历史记录',
          mimeType: 'application/json',
        },
        {
          uri: 'linkscope://hints',
          name: 'screen_hints',
          description: '屏幕提示规则',
          mimeType: 'application/json',
        },
      ],
    }))

    // 处理工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      try {
        switch (name) {
          case 'detect_link_status':
            return await this.handleDetectLinkStatus(args)
          case 'batch_detect':
            return await this.handleBatchDetect(args)
          case 'get_task_results':
            return await this.handleGetTaskResults(args)
          case 'export_results':
            return await this.handleExportResults(args)
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    })

    // 处理资源读取
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params

      try {
        switch (uri) {
          case 'linkscope://platforms':
            return await this.handleGetPlatformConfigs()
          case 'linkscope://history':
            return await this.handleGetDetectionHistory()
          case 'linkscope://hints':
            return await this.handleGetScreenHints()
          default:
            throw new Error(`Unknown resource: ${uri}`)
        }
      } catch (error) {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            },
          ],
        }
      }
    })
  }

  private async handleDetectLinkStatus(args: unknown) {
    const input = DetectLinkStatusSchema.parse(args)

    const result = await this.detectLink(input.url, input.options)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  }

  private async handleBatchDetect(args: unknown) {
    const input = BatchDetectSchema.parse(args)

    const concurrency = input.options?.concurrency ?? 5
    const results: unknown[] = []

    // 分批并发执行
    for (let i = 0; i < input.urls.length; i += concurrency) {
      const batch = input.urls.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map(url => this.detectLink(url, input.options))
      )
      results.push(...batchResults)
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    }
  }

  private async handleGetTaskResults(args: unknown) {
    const input = GetTaskResultsSchema.parse(args)

    const results = await this.tasksService.getTaskResults(input.taskId, {})

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    }
  }

  private async handleExportResults(args: unknown) {
    const input = ExportResultsSchema.parse(args)

    if (input.format === 'json') {
      const results = await this.tasksService.getTaskResults(input.taskId, {})
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      }
    }

    const format = input.format === 'excel' ? 'xlsx' : 'csv'
    const exported = await this.exportService.exportTask(input.taskId, format)

    return {
      content: [
        {
          type: 'text',
          text: `导出成功: ${exported.filename} (${exported.mimeType})`,
        },
      ],
    }
  }

  private async handleGetPlatformConfigs() {
    return {
      contents: [
        {
          uri: 'linkscope://platforms',
          mimeType: 'application/json',
          text: JSON.stringify(PLATFORM_CONFIGS.map(p => ({
            id: p.id,
            name: p.name,
            domains: p.domains,
          })), null, 2),
        },
      ],
    }
  }

  private async handleGetDetectionHistory() {
    const history = await this.tasksService.listTasks(1, 20)
    return {
      contents: [
        {
          uri: 'linkscope://history',
          mimeType: 'application/json',
          text: JSON.stringify(history, null, 2),
        },
      ],
    }
  }

  private async handleGetScreenHints() {
    // 获取所有平台的 screen hints
    const allHints: Record<string, unknown[]> = {}
    for (const platform of PLATFORM_CONFIGS) {
      try {
        const hints = await this.screenHintsService.getHintsForProbe(platform.id)
        if (hints.length > 0) {
          allHints[platform.id] = hints
        }
      } catch {
        // 忽略无 hints 的平台
      }
    }

    return {
      contents: [
        {
          uri: 'linkscope://hints',
          mimeType: 'application/json',
          text: JSON.stringify(allHints, null, 2),
        },
      ],
    }
  }

  /**
   * 核心检测逻辑：执行 L1 HTTP 探测 + 可选 L2 浏览器探测
   */
  private async detectLink(url: string, options?: {
    skipBrowser?: boolean
    skipAi?: boolean
    platform?: string
  }) {
    const platform = options?.platform || detectPlatform(url)?.id || 'generic'

    // L1: HTTP 探测
    const httpResult = await this.httpProbeService.probe(url)

    let browserResult = null
    let verifiedBy: 'http' | 'browser' | 'ai' | 'rule' = 'http'

    // L2: 浏览器探测（如果需要且未跳过）
    if (!options?.skipBrowser && this.httpProbeService.shouldTriggerBrowserFallback(url, httpResult)) {
      try {
        const taskUrlId = 'mcp-' + Date.now()
        browserResult = await this.browserProbeService.probe(url, taskUrlId, {
          skipScreenshot: true,
          platform,
        })
        verifiedBy = 'browser'
      } catch (err) {
        this.logger.warn(`Browser probe failed for ${url}: ${err}`)
      }
    }

    // 构建证据
    const finalUrl = browserResult?.finalUrl || httpResult.finalUrl
    let displayUrl = finalUrl
    try {
      displayUrl = stripTrackingParams(finalUrl)
    } catch { /* keep original */ }

    const signals: string[] = []
    if (httpResult.errorCode) signals.push(`http_error:${httpResult.errorCode}`)
    if (httpResult.statusCode) signals.push(`http_status:${httpResult.statusCode}`)
    if (browserResult?.domSignals) {
      for (const s of browserResult.domSignals) {
        signals.push(`${s.signal}:${s.value}`)
      }
    }

    // 简化判定逻辑
    const finalStatus = this.determineStatus(httpResult, browserResult)

    return {
      url,
      platform,
      finalStatus,
      http: {
        statusCode: httpResult.statusCode,
        finalUrl: httpResult.finalUrl,
        latencyMs: httpResult.latencyMs,
        errorCode: httpResult.errorCode,
        redirectChain: httpResult.redirectChain,
      },
      browser: browserResult ? {
        pageTitle: browserResult.pageTitle,
        finalUrl: browserResult.finalUrl,
        domSignals: browserResult.domSignals,
        errorCode: browserResult.errorCode,
      } : null,
      evidence: {
        finalUrl: displayUrl,
        signals,
        verifiedBy,
      },
    }
  }

  /**
   * 基于 HTTP + 浏览器信号的简化判定
   */
  private determineStatus(
    httpResult: { statusCode: number | null; errorCode: string | null },
    browserResult: { domSignals?: Array<{ signal: string }>; errorCode?: string | null } | null,
  ): FinalStatus {
    const status = httpResult.statusCode
    const err = httpResult.errorCode

    // 浏览器检测到下架信号
    if (browserResult?.domSignals?.some(s => s.signal === 'dead_content_text' || s.signal === 'user_screen_hint')) {
      return 'dead_link'
    }

    // 浏览器自身导航失败
    if (browserResult?.errorCode && ['dns_failed', 'connection_refused', 'connection_reset', 'unreachable'].includes(browserResult.errorCode)) {
      return 'dead_link'
    }

    // 明确的 HTTP 错误
    if (status === 404 || status === 410) return 'dead_link'
    if (status === 451) return 'dead_link'

    // 网络层失败
    if (err && ['dns_failed', 'connection_refused', 'connection_reset', 'connection_closed', 'unreachable'].includes(err)) {
      return 'dead_link'
    }

    // 需要认证/被拦截
    if (status === 401 || status === 403 || status === 429) return 'review_required'

    // HTTP 正常 + 无浏览器下架信号 → 可访问
    if (status === 200 && !browserResult?.errorCode) return 'accessible'

    // 其他情况需要复核
    return 'review_required'
  }

  async start() {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    this.logger.log('LinkScope MCP Server started on stdio')
  }
}

// 独立启动入口（非 NestJS 环境下直接运行）
if (require.main === module) {
  console.error('LinkScope MCP Server must be started through NestJS bootstrap. Use: pnpm --filter @linkscope/api dev')
  process.exit(1)
}
