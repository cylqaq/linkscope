import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface AntiDetectionConfig {
  /** 启用 TLS 指纹模拟 */
  enableTlsFingerprint: boolean
  /** 启用浏览器指纹随机化 */
  enableBrowserFingerprint: boolean
  /** 启用行为模拟 */
  enableBehaviorSimulation: boolean
  /** 启用请求头顺序优化 */
  enableHeaderOrder: boolean
  /** 启用住宅代理支持 */
  enableResidentialProxy: boolean
  /** 代理服务器列表 */
  proxyServers: string[]
  /** 超时时间（毫秒） */
  requestTimeoutMs: number
  /** 最大重定向次数 */
  maxRedirects: number
  /** User-Agent 列表（自定义） */
  customUserAgents?: string[]
}

export interface BrowserFingerprint {
  canvas: string
  webgl: string
  fonts: string[]
  screenResolution: string
  colorDepth: number
  timezone: string
  language: string
  platform: string
}

export interface BehaviorPattern {
  mouseMovement: {
    speed: number
    acceleration: number
    jitter: number
  }
  scrollPattern: {
    speed: number
    frequency: number
    direction: 'up' | 'down' | 'mixed'
  }
  clickPattern: {
    delay: number
    doubleClickSpeed: number
  }
  typingPattern: {
    speed: number
    errorRate: number
  }
}

@Injectable()
export class AntiDetectionService {
  private readonly logger = new Logger(AntiDetectionService.name)
  private readonly config: AntiDetectionConfig

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig()
    this.logger.log('AntiDetection config loaded', {
      enableResidentialProxy: this.config.enableResidentialProxy,
      proxyCount: this.config.proxyServers.length,
      requestTimeoutMs: this.config.requestTimeoutMs,
    })
  }

  /**
   * 从环境变量加载配置
   */
  private loadConfig(): AntiDetectionConfig {
    // 解析代理列表（逗号分隔）
    const proxyEnv = this.configService.get<string>('ANTI_DETECTION_PROXIES', '')
    const proxyServers = proxyEnv
      ? proxyEnv.split(',').map(p => p.trim()).filter(Boolean)
      : []

    // 解析自定义 User-Agent 列表
    const uaEnv = this.configService.get<string>('ANTI_DETECTION_USER_AGENTS', '')
    const customUserAgents = uaEnv
      ? uaEnv.split('\n').map(u => u.trim()).filter(Boolean)
      : undefined

    return {
      enableTlsFingerprint: this.configService.get<boolean>('ANTI_DETECTION_TLS_FINGERPRINT', true),
      enableBrowserFingerprint: this.configService.get<boolean>('ANTI_DETECTION_BROWSER_FINGERPRINT', true),
      enableBehaviorSimulation: this.configService.get<boolean>('ANTI_DETECTION_BEHAVIOR_SIM', true),
      enableHeaderOrder: this.configService.get<boolean>('ANTI_DETECTION_HEADER_ORDER', true),
      enableResidentialProxy: this.configService.get<boolean>('ANTI_DETECTION_RESIDENTIAL_PROXY', false),
      proxyServers,
      requestTimeoutMs: this.configService.get<number>('ANTI_DETECTION_TIMEOUT_MS', 15000),
      maxRedirects: this.configService.get<number>('ANTI_DETECTION_MAX_REDIRECTS', 10),
      customUserAgents,
    }
  }

  /**
   * 获取配置（只读）
   */
  getConfig(): Readonly<AntiDetectionConfig> {
    return { ...this.config }
  }

  /**
   * 获取请求超时时间
   */
  getRequestTimeoutMs(): number {
    return this.config.requestTimeoutMs
  }

  /**
   * 获取最大重定向次数
   */
  getMaxRedirects(): number {
    return this.config.maxRedirects
  }

  /**
   * 获取随机化的浏览器指纹
   */
  getRandomizedFingerprint(): BrowserFingerprint {
    return {
      canvas: this.generateCanvasFingerprint(),
      webgl: this.generateWebGLFingerprint(),
      fonts: this.getRandomFonts(),
      screenResolution: this.getRandomScreenResolution(),
      colorDepth: this.getRandomColorDepth(),
      timezone: this.getRandomTimezone(),
      language: this.getRandomLanguage(),
      platform: this.getRandomPlatform(),
    }
  }

  /**
   * 获取行为模拟模式
   */
  getBehaviorPattern(): BehaviorPattern {
    return {
      mouseMovement: {
        speed: this.randomBetween(100, 500),
        acceleration: this.randomBetween(0.1, 0.5),
        jitter: this.randomBetween(0, 2),
      },
      scrollPattern: {
        speed: this.randomBetween(100, 300),
        frequency: this.randomBetween(1, 5),
        direction: this.getRandomScrollDirection(),
      },
      clickPattern: {
        delay: this.randomBetween(50, 200),
        doubleClickSpeed: this.randomBetween(100, 300),
      },
      typingPattern: {
        speed: this.randomBetween(50, 150),
        errorRate: this.randomBetween(0, 0.05),
      },
    }
  }

  /**
   * 获取随机化的请求头顺序
   */
  getRandomizedHeaders(): Record<string, string> {
    const baseHeaders = {
      'User-Agent': this.getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    }

    // 随机化顺序
    const headers: Record<string, string> = {}
    const keys = Object.keys(baseHeaders).sort(() => Math.random() - 0.5)
    keys.forEach(key => {
      headers[key] = baseHeaders[key as keyof typeof baseHeaders]
    })

    // 添加 sec-ch-ua 头（Chrome 89+）
    if (this.config.enableHeaderOrder) {
      headers['sec-ch-ua'] = this.getSecChUa()
      headers['sec-ch-ua-mobile'] = '?0'
      headers['sec-ch-ua-platform'] = '"Windows"'
    }

    return headers
  }

  /**
   * 获取随机代理服务器
   */
  getRandomProxy(): string | null {
    if (!this.config.enableResidentialProxy || !this.config.proxyServers.length) {
      return null
    }
    const index = Math.floor(Math.random() * this.config.proxyServers.length)
    return this.config.proxyServers[index]
  }

  /**
   * 生成随机化的 stealth 脚本
   */
  generateStealthScript(): string {
    const fingerprint = this.getRandomizedFingerprint()
    const behavior = this.getBehaviorPattern()

    return `
      // 基础 stealth 补丁
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }],
      });

      // 指纹随机化
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type) {
        if (type === 'image/png') {
          // 添加微小噪声
          const ctx = this.getContext('2d');
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
              data[i] = Math.max(0, Math.min(255, data[i] + Math.random() * 2 - 1));
            }
            ctx.putImageData(imageData, 0, 0);
          }
        }
        return originalToDataURL.apply(this, arguments);
      };

      // WebGL 指纹随机化
      const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel Iris OpenGL Engine';
        }
        return originalGetParameter.apply(this, arguments);
      };

      // 字体指纹随机化
      const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function(text) {
        const result = originalMeasureText.apply(this, arguments);
        result.width += Math.random() * 0.1;
        return result;
      };

      // 行为模拟 - 鼠标轨迹
      let lastMouseX = 0, lastMouseY = 0;
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'mousemove') {
          const wrappedListener = function(event) {
            const dx = event.clientX - lastMouseX;
            const dy = event.clientY - lastMouseY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 10) {
              // 添加微小抖动
              event.clientX += (Math.random() - 0.5) * ${behavior.mouseMovement.jitter};
              event.clientY += (Math.random() - 0.5) * ${behavior.mouseMovement.jitter};
            }
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
            return listener.call(this, event);
          };
          return originalAddEventListener.call(this, type, wrappedListener, options);
        }
        return originalAddEventListener.call(this, type, listener, options);
      };

      // 屏幕分辨率随机化
      Object.defineProperty(screen, 'width', { get: () => ${fingerprint.screenResolution.split('x')[0]} });
      Object.defineProperty(screen, 'height', { get: () => ${fingerprint.screenResolution.split('x')[1]} });
      Object.defineProperty(screen, 'colorDepth', { get: () => ${fingerprint.colorDepth} });

      // 时区随机化
      Date.prototype.getTimezoneOffset = function() {
        return ${this.getTimezoneOffset(fingerprint.timezone)};
      };
    `
  }

  /**
   * 获取随机 User-Agent
   */
  private getRandomUserAgent(): string {
    // 如果配置了自定义 UA 列表，优先使用
    if (this.config.customUserAgents && this.config.customUserAgents.length > 0) {
      return this.config.customUserAgents[Math.floor(Math.random() * this.config.customUserAgents.length)]
    }

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    ]
    return userAgents[Math.floor(Math.random() * userAgents.length)]
  }

  /**
   * 生成 Canvas 指纹
   */
  private generateCanvasFingerprint(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * 生成 WebGL 指纹
   */
  private generateWebGLFingerprint(): string {
    const vendors = ['Intel Inc.', 'NVIDIA Corporation', 'AMD']
    const renderers = ['Intel Iris OpenGL Engine', 'NVIDIA GeForce GTX 1080', 'AMD Radeon RX 580']
    return `${vendors[Math.floor(Math.random() * vendors.length)]} - ${renderers[Math.floor(Math.random() * renderers.length)]}`
  }

  /**
   * 获取随机字体列表
   */
  private getRandomFonts(): string[] {
    const allFonts = [
      'Arial', 'Helvetica', 'Times New Roman', 'Times', 'Courier New', 'Courier',
      'Verdana', 'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Trebuchet MS',
      'Comic Sans MS', 'Impact', 'Lucida Console', 'Monaco', 'Consolas',
    ]
    const count = Math.floor(Math.random() * 5) + 10
    const shuffled = allFonts.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, count)
  }

  /**
   * 获取随机屏幕分辨率
   */
  private getRandomScreenResolution(): string {
    const resolutions = ['1920x1080', '1366x768', '1536x864', '1440x900', '1280x720', '2560x1440']
    return resolutions[Math.floor(Math.random() * resolutions.length)]
  }

  /**
   * 获取随机颜色深度
   */
  private getRandomColorDepth(): number {
    return Math.random() > 0.5 ? 24 : 32
  }

  /**
   * 获取随机时区
   */
  private getRandomTimezone(): string {
    const timezones = ['Asia/Shanghai', 'Asia/Tokyo', 'America/New_York', 'Europe/London', 'Europe/Berlin']
    return timezones[Math.floor(Math.random() * timezones.length)]
  }

  /**
   * 获取时区偏移量
   */
  private getTimezoneOffset(timezone: string): number {
    const offsets: Record<string, number> = {
      'Asia/Shanghai': -480,
      'Asia/Tokyo': -540,
      'America/New_York': 300,
      'Europe/London': 0,
      'Europe/Berlin': -60,
    }
    return offsets[timezone] || -480
  }

  /**
   * 获取随机语言
   */
  private getRandomLanguage(): string {
    const languages = ['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'ja-JP']
    return languages[Math.floor(Math.random() * languages.length)]
  }

  /**
   * 获取随机平台
   */
  private getRandomPlatform(): string {
    const platforms = ['Win32', 'MacIntel', 'Linux x86_64']
    return platforms[Math.floor(Math.random() * platforms.length)]
  }

  /**
   * 获取随机滚动方向
   */
  private getRandomScrollDirection(): 'up' | 'down' | 'mixed' {
    const directions: ('up' | 'down' | 'mixed')[] = ['up', 'down', 'mixed']
    return directions[Math.floor(Math.random() * directions.length)]
  }

  /**
   * 生成 sec-ch-ua 头
   */
  private getSecChUa(): string {
    const versions = ['124', '123', '122', '121']
    const version = versions[Math.floor(Math.random() * versions.length)]
    return `"Chromium";v="${version}", "Google Chrome";v="${version}", "Not-A.Brand";v="99"`
  }

  /**
   * 生成随机数
   */
  private randomBetween(min: number, max: number): number {
    return Math.random() * (max - min) + min
  }
}
