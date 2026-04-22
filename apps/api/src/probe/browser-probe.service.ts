import { Injectable, Logger } from '@nestjs/common'
import type { BrowserProbeResult, DomSignal } from '@linkscope/shared'
import * as path from 'path'
import * as fs from 'fs'

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || './screenshots'
const PAGE_TIMEOUT = 20000
const WAIT_FOR = 3000

// Common soft-404 / removed text patterns (Chinese + English)
const DEAD_TEXT_PATTERNS = [
  /该内容已被删除/,
  /内容不存在/,
  /页面不存在/,
  /404\s*(not found)?/i,
  /this page (doesn't|does not) exist/i,
  /content (has been|was) (deleted|removed)/i,
  /video (has been|was) (deleted|removed)/i,
  /we couldn.t find (this|that) page/i,
  /抱歉[\s，,]*(此|该)?页面(不存在|已(被)?删除|暂时无法访问)/,
  /找不到页面/,
  /您访问的页面不存在/,
  /该视频已(被(作者)?)?删除/,
  /该微博已删除/,
  /笔记不存在/,
  /该作品已被删除/,
]

@Injectable()
export class BrowserProbeService {
  private readonly logger = new Logger(BrowserProbeService.name)
  private playwright: any = null

  async probe(url: string, taskUrlId: string): Promise<BrowserProbeResult> {
    let browser: any = null
    let page: any = null

    try {
      const pw = await this.getPlaywright()
      browser = await pw.chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      })

      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'zh-CN',
        viewport: { width: 1280, height: 800 },
        extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      })

      // Stealth patches
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        ;(window as any).chrome = { runtime: {} }
        Object.defineProperty(navigator, 'plugins', {
          get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }],
        })
      })

      page = await context.newPage()
      page.setDefaultTimeout(PAGE_TIMEOUT)

      let finalUrl = url
      page.on('response', (resp: any) => {
        if (resp.request().isNavigationRequest()) finalUrl = resp.url()
      })

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT })

      // Wait a bit for JS-rendered content
      await page.waitForTimeout(WAIT_FOR)

      const pageTitle = await page.title().catch(() => null)
      const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? '').catch(() => '')

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

      // Screenshot
      let screenshotPath: string | null = null
      try {
        if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
        screenshotPath = path.join(SCREENSHOT_DIR, `${taskUrlId}.jpg`)
        await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 75, fullPage: false })
      } catch (e) {
        this.logger.warn(`Screenshot failed for ${url}: ${e}`)
        screenshotPath = null
      }

      return {
        pageTitle,
        pageText: pageText.slice(0, 2000),
        finalUrl,
        screenshotPath,
        domSignals,
        errorCode: null,
      }
    } catch (err: any) {
      const errorCode = err?.name === 'TimeoutError' ? 'timeout' : 'browser_error'
      this.logger.error(`Browser probe failed for ${url}: ${err?.message}`)
      return {
        pageTitle: null,
        pageText: null,
        finalUrl: url,
        screenshotPath: null,
        domSignals: [],
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
}
