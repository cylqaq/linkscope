import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Browser, BrowserContext, Page } from 'playwright'

export interface BrowserPoolConfig {
  /** 最大浏览器实例数 */
  maxBrowsers: number
  /** 每个浏览器最大上下文数 */
  maxContextsPerBrowser: number
  /** 上下文空闲超时时间（毫秒） */
  contextIdleTimeout: number
  /** 浏览器空闲超时时间（毫秒） */
  browserIdleTimeout: number
  /** 启用上下文复用 */
  enableContextReuse: boolean
}

export interface PooledBrowser {
  browser: Browser
  contexts: Map<string, { context: BrowserContext; lastUsed: number }>
  lastUsed: number
}

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name)
  private readonly config: BrowserPoolConfig
  private readonly browsers: Map<string, PooledBrowser> = new Map()
  private playwright: any = null
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    this.config = {
      maxBrowsers: parseInt(process.env.BROWSER_POOL_MAX_BROWSERS || '3', 10),
      maxContextsPerBrowser: parseInt(process.env.BROWSER_POOL_MAX_CONTEXTS || '5', 10),
      contextIdleTimeout: parseInt(process.env.BROWSER_POOL_CONTEXT_TIMEOUT || '30000', 10),
      browserIdleTimeout: parseInt(process.env.BROWSER_POOL_BROWSER_TIMEOUT || '300000', 10),
      enableContextReuse: process.env.BROWSER_POOL_CONTEXT_REUSE !== 'false',
    }
  }

  async onModuleInit() {
    // 启动清理定时器
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleResources()
    }, 30000) // 每30秒清理一次
  }

  async onModuleDestroy() {
    // 清理定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    // 关闭所有浏览器
    await this.closeAllBrowsers()
  }

  /**
   * 获取浏览器上下文
   */
  async getContext(url: string): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await this.getBrowser()
    
    // 如果启用上下文复用，尝试获取空闲上下文
    if (this.config.enableContextReuse) {
      const existingContext = this.findIdleContext(browser)
      if (existingContext) {
        this.logger.debug(`Reusing existing context for ${url}`)
        const page = await existingContext.newPage()
        return { context: existingContext, page }
      }
    }

    // 创建新上下文
    this.logger.debug(`Creating new context for ${url}`)
    const context = await browser.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      viewport: { width: 1280, height: 800 },
    })

    // 添加 stealth 补丁
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      ;(window as any).chrome = { runtime: {} }
    })

    // 记录上下文
    const contextId = this.generateContextId()
    browser.contexts.set(contextId, { context, lastUsed: Date.now() })

    const page = await context.newPage()
    return { context, page }
  }

  /**
   * 释放上下文
   */
  async releaseContext(context: BrowserContext): Promise<void> {
    // 关闭上下文中的所有页面
    const pages = context.pages()
    await Promise.all(pages.map(page => page.close().catch(() => {})))

    // 如果启用上下文复用，保留上下文
    if (this.config.enableContextReuse) {
      // 更新最后使用时间
      for (const [browserId, browser] of this.browsers) {
        for (const [contextId, ctx] of browser.contexts) {
          if (ctx.context === context) {
            ctx.lastUsed = Date.now()
            this.logger.debug(`Context ${contextId} marked as idle`)
            return
          }
        }
      }
    }

    // 否则关闭上下文
    await context.close().catch(() => {})
  }

  /**
   * 获取浏览器实例
   */
  private async getBrowser(): Promise<PooledBrowser> {
    // 查找可用的浏览器实例
    for (const [browserId, browser] of this.browsers) {
      if (browser.contexts.size < this.config.maxContextsPerBrowser) {
        browser.lastUsed = Date.now()
        return browser
      }
    }

    // 如果没有可用实例且未达到最大数量，创建新实例
    if (this.browsers.size < this.config.maxBrowsers) {
      return await this.createBrowser()
    }

    // 如果达到最大数量，等待并重试
    this.logger.warn('All browsers are busy, waiting for available slot...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    return this.getBrowser()
  }

  /**
   * 创建新的浏览器实例
   */
  private async createBrowser(): Promise<PooledBrowser> {
    const pw = await this.getPlaywright()
    const browser = await pw.chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
      ],
    })

    const browserId = this.generateBrowserId()
    const pooledBrowser: PooledBrowser = {
      browser,
      contexts: new Map(),
      lastUsed: Date.now(),
    }

    this.browsers.set(browserId, pooledBrowser)
    this.logger.log(`Created new browser instance ${browserId}`)

    return pooledBrowser
  }

  /**
   * 查找空闲上下文
   */
  private findIdleContext(browser: PooledBrowser): BrowserContext | null {
    const now = Date.now()
    for (const [contextId, ctx] of browser.contexts) {
      // 检查是否空闲且未超时
      if (now - ctx.lastUsed < this.config.contextIdleTimeout) {
        // 检查上下文是否还有活跃页面
        const pages = ctx.context.pages()
        if (pages.length === 0) {
          ctx.lastUsed = now
          return ctx.context
        }
      }
    }
    return null
  }

  /**
   * 清理空闲资源
   */
  private async cleanupIdleResources(): Promise<void> {
    const now = Date.now()

    // 清理空闲上下文
    for (const [browserId, browser] of this.browsers) {
      for (const [contextId, ctx] of browser.contexts) {
        if (now - ctx.lastUsed > this.config.contextIdleTimeout) {
          this.logger.debug(`Closing idle context ${contextId}`)
          await ctx.context.close().catch(() => {})
          browser.contexts.delete(contextId)
        }
      }
    }

    // 清理空闲浏览器
    for (const [browserId, browser] of this.browsers) {
      if (browser.contexts.size === 0 && now - browser.lastUsed > this.config.browserIdleTimeout) {
        this.logger.debug(`Closing idle browser ${browserId}`)
        await browser.browser.close().catch(() => {})
        this.browsers.delete(browserId)
      }
    }
  }

  /**
   * 关闭所有浏览器
   */
  private async closeAllBrowsers(): Promise<void> {
    this.logger.log('Closing all browser instances...')
    
    for (const [browserId, browser] of this.browsers) {
      // 关闭所有上下文
      for (const [contextId, ctx] of browser.contexts) {
        await ctx.context.close().catch(() => {})
      }
      
      // 关闭浏览器
      await browser.browser.close().catch(() => {})
    }

    this.browsers.clear()
  }

  /**
   * 获取 Playwright 实例
   */
  private async getPlaywright(): Promise<any> {
    if (!this.playwright) {
      this.playwright = await import('playwright')
    }
    return this.playwright
  }

  /**
   * 生成浏览器 ID
   */
  private generateBrowserId(): string {
    return `browser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 生成上下文 ID
   */
  private generateContextId(): string {
    return `context-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取池状态
   */
  getPoolStatus(): {
    totalBrowsers: number
    totalContexts: number
    availableBrowsers: number
  } {
    let totalContexts = 0
    let availableBrowsers = 0

    for (const [browserId, browser] of this.browsers) {
      totalContexts += browser.contexts.size
      if (browser.contexts.size < this.config.maxContextsPerBrowser) {
        availableBrowsers++
      }
    }

    return {
      totalBrowsers: this.browsers.size,
      totalContexts,
      availableBrowsers,
    }
  }
}