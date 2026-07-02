import { Injectable, Logger } from '@nestjs/common'

// 扩展Window接口以支持SPA框架检测
declare global {
  interface Window {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: any
    __VUE__?: any
    ng?: any
    __NEXT_DATA__?: any
    __NUXT__?: any
  }
}

export interface SmartWaitOptions {
  /** 最小等待时间（毫秒） */
  minWaitMs?: number
  /** 最大等待时间（毫秒） */
  maxWaitMs?: number
  /** 默认等待时间（毫秒） */
  defaultWaitMs?: number
  /** 是否启用智能等待 */
  enabled?: boolean
}

export interface PageCharacteristics {
  /** 是否是SPA框架 */
  isSPA: boolean
  /** 网络请求数量 */
  networkRequestCount: number
  /** DOM变化频率（每秒变化次数） */
  domChangeRate: number
  /** 页面加载状态 */
  loadState: 'loading' | 'domcontentloaded' | 'networkidle' | 'complete'
  /** 是否有异步内容 */
  hasAsyncContent: boolean
}

@Injectable()
export class SmartWaitService {
  private readonly logger = new Logger(SmartWaitService.name)

  /**
   * 计算智能等待时间
   */
  calculateWaitTime(
    characteristics: PageCharacteristics,
    options: SmartWaitOptions = {},
  ): number {
    const {
      minWaitMs = 3000,
      maxWaitMs = 15000,
      defaultWaitMs = 5000,
      enabled = true,
    } = options

    if (!enabled) {
      return defaultWaitMs
    }

    let waitTime = defaultWaitMs

    // 1. 基于SPA框架调整
    if (characteristics.isSPA) {
      waitTime = Math.max(waitTime, 8000) // SPA页面至少等待8秒
    }

    // 2. 基于网络请求数量调整
    if (characteristics.networkRequestCount > 20) {
      waitTime = Math.max(waitTime, 10000)
    } else if (characteristics.networkRequestCount > 10) {
      waitTime = Math.max(waitTime, 6000)
    }

    // 3. 基于DOM变化频率调整
    if (characteristics.domChangeRate > 5) {
      waitTime = Math.max(waitTime, 7000) // 频繁变化页面增加等待
    }

    // 4. 基于页面加载状态调整
    if (characteristics.loadState === 'loading') {
      waitTime = Math.max(waitTime, 8000) // 仍在加载的页面增加等待
    }

    // 5. 基于异步内容调整
    if (characteristics.hasAsyncContent) {
      waitTime = Math.max(waitTime, 6000) // 有异步内容的页面增加等待
    }

    // 确保在范围内
    waitTime = Math.max(minWaitMs, Math.min(maxWaitMs, waitTime))

    this.logger.debug(`Smart wait calculated: ${waitTime}ms`, {
      characteristics,
      options,
    })

    return waitTime
  }

  /**
   * 检测页面特征
   */
  async detectPageCharacteristics(page: any): Promise<PageCharacteristics> {
    const characteristics: PageCharacteristics = {
      isSPA: false,
      networkRequestCount: 0,
      domChangeRate: 0,
      loadState: 'loading',
      hasAsyncContent: false,
    }

    try {
      // 检测SPA框架
      characteristics.isSPA = await this.detectSPAFramework(page)

      // 检测网络请求数量
      characteristics.networkRequestCount = await this.getNetworkRequestCount(page)

      // 检测DOM变化频率
      characteristics.domChangeRate = await this.detectDOMChangeRate(page)

      // 检测页面加载状态
      characteristics.loadState = await this.getLoadState(page)

      // 检测异步内容
      characteristics.hasAsyncContent = await this.detectAsyncContent(page)
    } catch (error) {
      this.logger.warn(`Failed to detect page characteristics: ${error}`)
    }

    return characteristics
  }

  /**
   * 检测SPA框架
   */
  private async detectSPAFramework(page: any): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        // 检测React
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || 
            document.querySelector('[data-reactroot]') ||
            document.querySelector('[data-reactid]')) {
          return true
        }

        // 检测Vue
        if (window.__VUE__ || 
            document.querySelector('[data-v-]') ||
            document.querySelector('.__vue__')) {
          return true
        }

        // 检测Angular
        if (window.ng || 
            document.querySelector('[ng-version]') ||
            document.querySelector('[ng-app]')) {
          return true
        }

        // 检测Next.js
        if (window.__NEXT_DATA__ || 
            document.querySelector('#__next')) {
          return true
        }

        // 检测Nuxt.js
        if (window.__NUXT__ || 
            document.querySelector('#__nuxt')) {
          return true
        }

        return false
      })
    } catch {
      return false
    }
  }

  /**
   * 获取网络请求数量
   */
  private async getNetworkRequestCount(page: any): Promise<number> {
    try {
      return await page.evaluate(() => {
        // 使用Performance API获取请求数量
        const entries = performance.getEntriesByType('resource')
        return entries.length
      })
    } catch {
      return 0
    }
  }

  /**
   * 检测DOM变化频率
   */
  private async detectDOMChangeRate(page: any): Promise<number> {
    try {
      return await page.evaluate(() => {
        return new Promise<number>((resolve) => {
          let changeCount = 0
          const startTime = Date.now()

          const observer = new MutationObserver(() => {
            changeCount++
          })

          observer.observe(document.body, {
            childList: true,
            subtree: true,
          })

          // 观察1秒
          setTimeout(() => {
            observer.disconnect()
            const duration = (Date.now() - startTime) / 1000
            const rate = changeCount / duration
            resolve(rate)
          }, 1000)
        })
      })
    } catch {
      return 0
    }
  }

  /**
   * 获取页面加载状态
   */
  private async getLoadState(page: any): Promise<PageCharacteristics['loadState']> {
    try {
      const readyState = await page.evaluate(() => document.readyState)
      
      switch (readyState) {
        case 'loading':
          return 'loading'
        case 'interactive':
          return 'domcontentloaded'
        case 'complete':
          return 'complete'
        default:
          return 'loading'
      }
    } catch {
      return 'loading'
    }
  }

  /**
   * 检测异步内容
   */
  private async detectAsyncContent(page: any): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        // 检测常见的异步内容标记
        const asyncSelectors = [
          '[data-async]',
          '[data-loading]',
          '.loading',
          '.spinner',
          '.skeleton',
          '[placeholder]',
        ]

        for (const selector of asyncSelectors) {
          if (document.querySelector(selector)) {
            return true
          }
        }

        // 检测fetch/XHR请求
        const entries = performance.getEntriesByType('resource')
        const asyncEntries = entries.filter(entry => {
          const resourceEntry = entry as PerformanceResourceTiming
          return resourceEntry.initiatorType === 'fetch' || 
                 resourceEntry.initiatorType === 'xmlhttprequest'
        })

        return asyncEntries.length > 0
      })
    } catch {
      return false
    }
  }
}
