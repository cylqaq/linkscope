import {
  stripTrackingParams,
  normalizeUrl,
  dedupeKey,
  extractUrlsFromText,
  isValidUrl,
  canonicalizeFinalUrl,
  DEFAULT_USER_AGENT,
} from '../url-utils'

describe('url-utils', () => {
  describe('stripTrackingParams', () => {
    it('should strip tracking parameters from URL', () => {
      const url = 'https://example.com/page?utm_source=test&utm_medium=test&normal=keep'
      const result = stripTrackingParams(url)
      expect(result).toBe('https://example.com/page?normal=keep')
    })

    it('should handle URL without tracking parameters', () => {
      const url = 'https://example.com/page?normal=keep'
      const result = stripTrackingParams(url)
      expect(result).toBe('https://example.com/page?normal=keep')
    })

    it('should handle URL without query parameters', () => {
      const url = 'https://example.com/page'
      const result = stripTrackingParams(url)
      expect(result).toBe('https://example.com/page')
    })

    it('should handle invalid URL gracefully', () => {
      const url = 'not-a-url'
      const result = stripTrackingParams(url)
      expect(result).toBe(url)
    })
  })

  describe('normalizeUrl', () => {
    it('should normalize URL by removing trailing slash', () => {
      const url = 'https://example.com/page/'
      const result = normalizeUrl(url)
      expect(result).toBe('https://example.com/page')
    })

    it('should normalize URL by converting to lowercase', () => {
      const url = 'https://EXAMPLE.COM/Page'
      const result = normalizeUrl(url)
      expect(result).toBe('https://example.com/Page')
    })

    it('should handle URL without trailing slash', () => {
      const url = 'https://example.com/page'
      const result = normalizeUrl(url)
      expect(result).toBe('https://example.com/page')
    })
  })

  describe('dedupeKey', () => {
    it('should generate dedupe key for URL', () => {
      const url = 'https://example.com/page?utm_source=test'
      const result = dedupeKey(url)
      expect(result).toBe('example.com/page')
    })

    it('should generate same key for normalized URLs', () => {
      const url1 = 'https://example.com/page/'
      const url2 = 'https://example.com/page'
      expect(dedupeKey(url1)).toBe(dedupeKey(url2))
    })

    it('should generate different keys for different URLs', () => {
      const url1 = 'https://example.com/page1'
      const url2 = 'https://example.com/page2'
      expect(dedupeKey(url1)).not.toBe(dedupeKey(url2))
    })
  })

  describe('extractUrlsFromText', () => {
    it('should extract URLs from text', () => {
      const text = 'Visit https://example.com and http://test.org for more info'
      const result = extractUrlsFromText(text)
      expect(result).toEqual(['https://example.com', 'http://test.org'])
    })

    it('should handle text without URLs', () => {
      const text = 'No URLs here'
      const result = extractUrlsFromText(text)
      expect(result).toEqual([])
    })

    it('should handle empty text', () => {
      const text = ''
      const result = extractUrlsFromText(text)
      expect(result).toEqual([])
    })

    it('should extract URLs with paths', () => {
      const text = 'Check https://example.com/path/to/page'
      const result = extractUrlsFromText(text)
      expect(result).toEqual(['https://example.com/path/to/page'])
    })
  })

  describe('isValidUrl', () => {
    it('should validate HTTP URL', () => {
      const url = 'http://example.com'
      expect(isValidUrl(url)).toBe(true)
    })

    it('should validate HTTPS URL', () => {
      const url = 'https://example.com'
      expect(isValidUrl(url)).toBe(true)
    })

    it('should reject invalid URL', () => {
      const url = 'not-a-url'
      expect(isValidUrl(url)).toBe(false)
    })

    it('should reject empty string', () => {
      const url = ''
      expect(isValidUrl(url)).toBe(false)
    })
  })

  describe('canonicalizeFinalUrl', () => {
    it('should canonicalize URL with tracking parameters', () => {
      const url = 'https://example.com/page?utm_source=test&normal=keep'
      const result = canonicalizeFinalUrl(url)
      expect(result).toBe('https://example.com/page?normal=keep')
    })

    it('should canonicalize URL without tracking parameters', () => {
      const url = 'https://example.com/page?normal=keep'
      const result = canonicalizeFinalUrl(url)
      expect(result).toBe('https://example.com/page?normal=keep')
    })

    it('should handle URL without query parameters', () => {
      const url = 'https://example.com/page'
      const result = canonicalizeFinalUrl(url)
      expect(result).toBe('https://example.com/page')
    })
  })

  describe('DEFAULT_USER_AGENT', () => {
    it('should be a valid user agent string', () => {
      expect(DEFAULT_USER_AGENT).toContain('Mozilla/5.0')
      expect(DEFAULT_USER_AGENT).toContain('Chrome')
    })
  })
})