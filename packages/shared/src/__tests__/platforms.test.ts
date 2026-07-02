import {
  detectPlatform,
  PLATFORM_CONFIGS,
  type PlatformConfig,
} from '../platforms'

describe('platforms', () => {
  describe('detectPlatform', () => {
    it('should detect Douyin platform', () => {
      const url = 'https://www.douyin.com/video/123456'
      const result = detectPlatform(url)
      expect(result).toBeDefined()
      expect(result?.id).toBe('douyin')
    })

    it('should detect Bilibili platform', () => {
      const url = 'https://www.bilibili.com/video/BV1234567890'
      const result = detectPlatform(url)
      expect(result).toBeDefined()
      expect(result?.id).toBe('bilibili')
    })

    it('should detect Xiaohongshu platform', () => {
      const url = 'https://www.xiaohongshu.com/explore/123456'
      const result = detectPlatform(url)
      expect(result).toBeDefined()
      expect(result?.id).toBe('xiaohongshu')
    })

    it('should detect Weibo platform', () => {
      const url = 'https://weibo.com/1234567890/AbCdEfGhI'
      const result = detectPlatform(url)
      expect(result).toBeDefined()
      expect(result?.id).toBe('weibo')
    })

    it('should detect Kuaishou platform', () => {
      const url = 'https://www.kuaishou.com/short-video/123456'
      const result = detectPlatform(url)
      expect(result).toBeDefined()
      expect(result?.id).toBe('kuaishou')
    })

    it('should return null for unknown platform', () => {
      const url = 'https://unknown-platform.com/video/123'
      const result = detectPlatform(url)
      expect(result).toBeNull()
    })

    it('should return null for invalid URL', () => {
      const url = 'not-a-url'
      const result = detectPlatform(url)
      expect(result).toBeNull()
    })
  })

  describe('PLATFORM_CONFIGS', () => {
    it('should be an array of platform configs', () => {
      expect(Array.isArray(PLATFORM_CONFIGS)).toBe(true)
      expect(PLATFORM_CONFIGS.length).toBeGreaterThan(0)
    })

    it('should have required fields for each platform', () => {
      PLATFORM_CONFIGS.forEach((config: PlatformConfig) => {
        expect(config.id).toBeDefined()
        expect(config.name).toBeDefined()
        expect(config.domains).toBeDefined()
        expect(Array.isArray(config.domains)).toBe(true)
        expect(config.domains.length).toBeGreaterThan(0)
      })
    })

    it('should have unique platform IDs', () => {
      const ids = PLATFORM_CONFIGS.map((config: PlatformConfig) => config.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('should have valid dead patterns', () => {
      PLATFORM_CONFIGS.forEach((config: PlatformConfig) => {
        if (config.deadPatterns) {
          expect(Array.isArray(config.deadPatterns)).toBe(true)
          config.deadPatterns.forEach((pattern: RegExp) => {
            expect(pattern).toBeInstanceOf(RegExp)
          })
        }
      })
    })

    it('should have valid login patterns', () => {
      PLATFORM_CONFIGS.forEach((config: PlatformConfig) => {
        if (config.loginPatterns) {
          expect(Array.isArray(config.loginPatterns)).toBe(true)
          config.loginPatterns.forEach((pattern: RegExp) => {
            expect(pattern).toBeInstanceOf(RegExp)
          })
        }
      })
    })

    it('should have valid private patterns', () => {
      PLATFORM_CONFIGS.forEach((config: PlatformConfig) => {
        if (config.privatePatterns) {
          expect(Array.isArray(config.privatePatterns)).toBe(true)
          config.privatePatterns.forEach((pattern: RegExp) => {
            expect(pattern).toBeInstanceOf(RegExp)
          })
        }
      })
    })
  })

  describe('Platform detection accuracy', () => {
    const testCases = [
      { url: 'https://www.douyin.com/video/123', expected: 'douyin' },
      { url: 'https://v.douyin.com/abc123/', expected: 'douyin' },
      { url: 'https://www.bilibili.com/video/BV123', expected: 'bilibili' },
      { url: 'https://b23.tv/abc123', expected: 'bilibili' },
      { url: 'https://www.xiaohongshu.com/explore/123', expected: 'xiaohongshu' },
      { url: 'https://xhslink.com/abc123', expected: 'xiaohongshu' },
      { url: 'https://weibo.com/123/abc', expected: 'weibo' },
      { url: 'https://m.weibo.cn/status/123', expected: 'weibo' },
      { url: 'https://www.kuaishou.com/short-video/123', expected: 'kuaishou' },
      { url: 'https://v.kuaishou.com/abc123', expected: 'kuaishou' },
    ]

    testCases.forEach(({ url, expected }) => {
      it(`should detect ${expected} from ${url}`, () => {
        const result = detectPlatform(url)
        expect(result).toBeDefined()
        expect(result?.id).toBe(expected)
      })
    })
  })
})