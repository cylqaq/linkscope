import { Injectable, Logger } from '@nestjs/common'
import {
  DEFAULT_USER_AGENT,
  detectPlatform,
  matchNetworkDeadDomSignals,
  stripTrackingParams,
  type BrowserProbeResult,
  type DomSignal,
  type NetworkSample,
} from '@linkscope/shared'
import { ScreenHintsService } from '../screen-hints/screen-hints.service'
import { SmartWaitService, type SmartWaitOptions } from './smart-wait.service'
import { AntiDetectionService } from './anti-detection.service'
import { resolveScreenshotStorageDir } from '../screenshot-storage'
import { createHash } from 'crypto'
import * as path from 'path'
import * as fs from 'fs'

const PAGE_TIMEOUT = 20000
const WAIT_FOR = 3000

// 智能等待配置
const SMART_WAIT_OPTIONS: SmartWaitOptions = {
  minWaitMs: parseInt(process.env.BROWSER_WAIT_MIN || '3000', 10),
  maxWaitMs: parseInt(process.env.BROWSER_WAIT_MAX || '15000', 10),
  defaultWaitMs: parseInt(process.env.BROWSER_WAIT_DEFAULT || '5000', 10),
  enabled: process.env.BROWSER_SMART_WAIT !== 'false',
}

const MAX_NETWORK_SAMPLES = 40
const MAX_NETWORK_BODY_READS = 12
const NETWORK_BODY_WAIT_MS = 3600
const SNIPPET_MAX = 3200

function redactResponseSnippet(raw: string, maxLen: number): string {
  let s = raw.replace(/\r\n/g, '\n')
  s = s.replace(
    /"(access_token|refresh_token|id_token|password|pwd|secret|cookie|authorization)"\s*:\s*"[^"]*"/gi,
    '"$1":"…"',
  )
  s = s.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer …')
  return s.slice(0, maxLen)
}

function dedupeNetworkSamples(rows: NetworkSample[]): NetworkSample[] {
  const m = new Map<string, NetworkSample>()
  for (const r of rows) {
    const key = `${r.method}:${r.status}:${r.url}`
    const prev = m.get(key)
    if (!prev || (r.snippet?.length ?? 0) > (prev.snippet?.length ?? 0)) m.set(key, r)
  }
  return [...m.values()].slice(0, 28)
}

export interface BrowserProbeOptions {
  /** AI 工具调用等场景跳过截图以降延迟 */
  skipScreenshot?: boolean
  /** 与 TaskUrl.platform 对齐，用于加载用户自定义下架文案 */
  platform?: string
}

// Common soft-404 / removed text patterns (Chinese + English)
const DEAD_TEXT_PATTERNS = [
  // 通用删除/不存在
  /该内容已被删除/,
  /内容已删除/,
  /内容不存在/,
  /内容不可用/,
  /内容不可见/,
  /内容已下[架线]/,
  /该内容已下[架线]/,
  /页面不存在/,
  /找不到页面/,
  /您访问的页面不存在/,
  /404\s*(not found)?/i,
  /this page (doesn't|does not) exist/i,
  /content (has been|was) (deleted|removed)/i,
  /we couldn.t find (this|that) page/i,
  /抱歉[\s，,]*(此|该)?页面(不存在|已(被)?删除|暂时无法访问)/,
  // 视频相关
  /视频已删除/,
  /视频不存在/,
  /视频不见了/,
  /视频去哪了/,
  /该视频已(被(作者)?)?删除/,
  /该视频已下[架线]/,
  /video (has been|was) (deleted|removed)/i,
  // 文章/笔记相关
  /文章不存在/,
  /该文章已(被)?删除/,
  /该文章已下线/,
  /笔记不存在/,
  /该笔记已(被)?删除/,
  // 微博/博文
  /微博不存在/,
  /该微博已删除/,
  /该博文已(被)?屏蔽/,
  // 作品/稿件
  /作品不存在/,
  /该作品已(被)?删除/,
  /稿件不可见/,
  /稿件已失效/,
  // 屏蔽/下架
  /该内容已(被)?屏蔽/,
  /此文已(被)?屏蔽/,
  /该内容已(被)?下架/,
]

@Injectable()
export class BrowserProbeService {
  private readonly logger = new Logger(BrowserProbeService.name)
  private playwright: any = null

  constructor(
    private readonly screenHints: ScreenHintsService,
    private readonly smartWait: SmartWaitService,
    private readonly antiDetection: AntiDetectionService,
  ) {}

  /**
   * 供 AI 在无截图模式下拉取渲染后文本，避免 axios 在抖音等站拿到的假 404/空壳。
   */
  async lightFetchForAi(url: string): Promise<BrowserProbeResult> {
    const id = 'ai-' + createHash('sha256').update(url).digest('hex').slice(0, 20)
    return this.probe(url, id, { skipScreenshot: true, platform: detectPlatform(url)?.id ?? 'generic' })
  }

  async probe(url: string, taskUrlId: string, opts?: BrowserProbeOptions): Promise<BrowserProbeResult> {
    let browser: any = null
    let page: any = null

    try {
      const pw = await this.getPlaywright()

      // 获取随机化的请求头
      const randomizedHeaders = this.antiDetection.getRandomizedHeaders()

      // 获取随机代理
      const proxy = this.antiDetection.getRandomProxy()

      // 浏览器启动参数
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ]

      // 如果有代理，添加代理参数
      if (proxy) {
        launchArgs.push(`--proxy-server=${proxy}`)
      }

      browser = await pw.chromium.launch({
        headless: true,
        args: launchArgs,
      })

      // 获取随机化的指纹
      const fingerprint = this.antiDetection.getRandomizedFingerprint()

      const context = await browser.newContext({
        userAgent: randomizedHeaders['User-Agent'] || DEFAULT_USER_AGENT,
        locale: fingerprint.language,
        viewport: {
          width: parseInt(fingerprint.screenResolution.split('x')[0]),
          height: parseInt(fingerprint.screenResolution.split('x')[1]),
        },
        extraHTTPHeaders: {
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...randomizedHeaders,
        },
      })

      // 生成随机化的 stealth 脚本
      const stealthScript = this.antiDetection.generateStealthScript()
      await context.addInitScript(stealthScript)

      page = await context.newPage()
      page.setDefaultTimeout(PAGE_TIMEOUT)

      let finalUrl = url
      const networkRows: NetworkSample[] = []
      const bodyPromises: Promise<void>[] = []
      let bodyReadBudget = 0

      page.on('response', (resp: any) => {
        try {
          const req = resp.request()
          if (req.isNavigationRequest()) finalUrl = resp.url()

          const rt = req.resourceType()
          if (rt !== 'xhr' && rt !== 'fetch') return
          if (networkRows.length >= MAX_NETWORK_SAMPLES) return

          let safeUrl = String(resp.url() || '')
          if (!/^https?:\/\//i.test(safeUrl)) return
          try {
            safeUrl = stripTrackingParams(safeUrl)
          } catch {
            /* keep */
          }
          if (safeUrl.length > 480) safeUrl = safeUrl.slice(0, 480) + '…'

          const headers = resp.headers() || {}
          const ctRaw = (headers['content-type'] || '').split(';')[0].trim()
          const contentType = ctRaw || 'unknown'
          const status = resp.status()
          const method = (req.method() as string) || 'GET'

          const cl = headers['content-length']
          if (cl && !Number.isNaN(parseInt(cl, 10)) && parseInt(cl, 10) > 524288) {
            networkRows.push({ url: safeUrl, status, method, resourceType: rt, contentType })
            return
          }

          const idx = networkRows.length
          networkRows.push({ url: safeUrl, status, method, resourceType: rt, contentType })

          if (
            bodyReadBudget < MAX_NETWORK_BODY_READS &&
            status === 200 &&
            /json|javascript|text\/plain/i.test(contentType)
          ) {
            bodyReadBudget++
            bodyPromises.push(
              resp
                .text()
                .then((txt: string) => {
                  if (networkRows[idx]) networkRows[idx].snippet = redactResponseSnippet(txt, SNIPPET_MAX)
                })
                .catch(() => {}),
            )
          }
        } catch {
          /* ignore */
        }
      })

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT })

      const isDouyinFlow = /douyin\.com/i.test(url) || /v\.douyin\.com/i.test(url)
      if (isDouyinFlow) {
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
      }

      // 智能等待策略
      let waitMs = WAIT_FOR
      if (isDouyinFlow) waitMs = 5500
      if (opts?.skipScreenshot) waitMs = Math.max(waitMs, 4500)

      // 使用智能等待服务计算等待时间
      if (SMART_WAIT_OPTIONS.enabled) {
        try {
          const characteristics = await this.smartWait.detectPageCharacteristics(page)
          const smartWaitMs = this.smartWait.calculateWaitTime(characteristics, SMART_WAIT_OPTIONS)
          waitMs = Math.max(waitMs, smartWaitMs)
          this.logger.debug(`Smart wait applied: ${smartWaitMs}ms`, { url, characteristics })
        } catch (error) {
          this.logger.warn(`Smart wait failed, using default: ${error}`)
        }
      }

      await page.waitForTimeout(waitMs)

      const pageTitle = await page.title().catch(() => null)
      const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? '').catch(() => '')

      await Promise.race([
        Promise.all(bodyPromises).catch(() => {}),
        new Promise<void>(resolve => setTimeout(resolve, NETWORK_BODY_WAIT_MS)),
      ])
      const networkSamples = dedupeNetworkSamples(networkRows)

      // Extract DOM signals
      const domSignals: DomSignal[] = []

      for (const pattern of DEAD_TEXT_PATTERNS) {
        if (pattern.test(pageText) || pattern.test(pageTitle ?? '')) {
          domSignals.push({
            type: 'text_match',
            signal: 'dead_content_text',
            value: pattern.source,
          })
        }
      }

      const platformKey = opts?.platform?.trim() || detectPlatform(url)?.id || 'generic'
      const haystack = `${pageText}\n${pageTitle ?? ''}`.slice(0, 12000)
      const hints = await this.screenHints.getHintsForProbe(platformKey)
      for (const h of hints) {
        const matched = h.caseSensitive
          ? haystack.includes(h.phrase)
          : haystack.toLowerCase().includes(h.phrase.toLowerCase())
        if (matched) {
          domSignals.push({
            type: 'text_match',
            signal: 'user_screen_hint',
            value: h.phrase.length > 200 ? `${h.phrase.slice(0, 200)}…` : h.phrase,
            hintId: h.id,
          })
        }
      }

      for (const s of matchNetworkDeadDomSignals(platformKey, networkSamples)) {
        domSignals.push(s)
      }

      // Screenshot
      let screenshotPath: string | null = null
      if (!opts?.skipScreenshot) {
        try {
          const shotDir = resolveScreenshotStorageDir()
          if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true })
          const filePath = path.join(shotDir, `${taskUrlId}.jpg`)
          await page.screenshot({ path: filePath, type: 'jpeg', quality: 75, fullPage: false })
          screenshotPath = `${taskUrlId}.jpg`
        } catch (e) {
          this.logger.warn(`Screenshot failed for ${url}: ${e}`)
          screenshotPath = null
        }
      }

      return {
        pageTitle,
        pageText: pageText.slice(0, 2000),
        finalUrl,
        screenshotPath,
        domSignals,
        networkSamples,
        errorCode: null,
      }
    } catch (err: any) {
      const errorCode = this.mapNavigationError(err)
      this.logger.error(`Browser probe failed for ${url}: ${err?.message}`)
      return {
        pageTitle: null,
        pageText: null,
        finalUrl: url,
        screenshotPath: null,
        domSignals: [],
        networkSamples: [],
        errorCode,
      }
    } finally {
      await page?.close().catch(() => {})
      await browser?.close().catch(() => {})
    }
  }

  private async getPlaywright() {
    if (!this.playwright) {
      this.playwright = require('playwright')
    }
    return this.playwright
  }

  /** 把 Playwright/Chromium 抛出的导航异常归一成 HTTP 层一致的 errorCode */
  private mapNavigationError(err: any): string {
    if (err?.name === 'TimeoutError') return 'timeout'
    const msg = String(err?.message || '')

    if (/ERR_NAME_NOT_RESOLVED|ERR_DNS_/i.test(msg)) return 'dns_failed'
    if (/ERR_CONNECTION_REFUSED|NS_ERROR_CONNECTION_REFUSED/i.test(msg)) return 'connection_refused'
    if (/ERR_CONNECTION_RESET|NS_ERROR_NET_RESET/i.test(msg)) return 'connection_reset'
    if (/ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i.test(msg)) return 'connection_closed'
    if (/ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|NS_ERROR_UNKNOWN_HOST/i.test(msg)) return 'unreachable'
    if (/ERR_CERT_|ERR_SSL_|NS_ERROR_NET_INTERRUPT/i.test(msg)) return 'ssl_error'

    return 'browser_error'
  }
}
