import { Injectable, Logger } from '@nestjs/common'
import axios, { AxiosError } from 'axios'
import type { HttpProbeResult } from '@linkscope/shared'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const TIMEOUT_MS = 15000
const MAX_REDIRECTS = 10

// Status codes that should not be retried
const NO_RETRY_CODES = new Set([400, 401, 403, 404, 405, 410, 451])

@Injectable()
export class HttpProbeService {
  private readonly logger = new Logger(HttpProbeService.name)

  async probe(url: string): Promise<HttpProbeResult> {
    const start = Date.now()

    // Try HEAD first
    try {
      const result = await this.doRequest('HEAD', url, start)
      return result
    } catch (headErr: any) {
      const code = headErr?.response?.status
      // 405 or 501 → retry with GET
      if (code === 405 || code === 501 || !code) {
        try {
          const result = await this.doRequest('GET', url, start, true)
          return { ...result, headFailed: true }
        } catch (getErr: any) {
          return this.buildErrorResult(url, start, getErr, true)
        }
      }
      // Other errors: return HEAD result
      return this.buildErrorResult(url, start, headErr, false)
    }
  }

  private async doRequest(
    method: 'HEAD' | 'GET',
    url: string,
    startTime: number,
    headFailed = false,
  ): Promise<HttpProbeResult> {
    const redirectChain: string[] = [url]

    const response = await axios.request({
      method,
      url,
      timeout: TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      validateStatus: () => true, // Don't throw on 4xx/5xx
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      onUploadProgress: undefined,
      // Capture redirects
      beforeRedirect: (opts: any, resp: any) => {
        if (resp.headers?.location) {
          redirectChain.push(resp.headers.location)
        }
      },
    })

    return {
      statusCode: response.status,
      finalUrl: response.request?.res?.responseUrl || url,
      redirectChain,
      latencyMs: Date.now() - startTime,
      errorCode: null,
      headFailed,
    }
  }

  private buildErrorResult(url: string, start: number, err: AxiosError, headFailed: boolean): HttpProbeResult {
    let errorCode = 'unknown_error'
    let statusCode: number | null = null

    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        errorCode = 'timeout'
      } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        errorCode = 'dns_failed'
      } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        errorCode = 'ssl_error'
      } else if (err.response) {
        statusCode = err.response.status
        errorCode = `http_${statusCode}`
      }
    }

    return {
      statusCode,
      finalUrl: url,
      redirectChain: [url],
      latencyMs: Date.now() - start,
      errorCode,
      headFailed,
    }
  }

  shouldTriggerBrowserFallback(result: HttpProbeResult): boolean {
    // Trigger browser probe when:
    // 1. Got 200 but might be soft 404 (JS-rendered page)
    // 2. Got 403 that might be a soft block
    // 3. No status (connection error for JS-heavy sites)
    if (result.statusCode === 200) return true
    if (result.statusCode === 403) return true
    if (result.errorCode === 'timeout' || !result.statusCode) return false
    return false
  }
}
