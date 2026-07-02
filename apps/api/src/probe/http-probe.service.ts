import { Injectable, Logger } from '@nestjs/common'
import axios, { AxiosError } from 'axios'
import { detectPlatform, DEFAULT_USER_AGENT, type HttpProbeResult } from '@linkscope/shared'
import { AntiDetectionService } from './anti-detection.service'

/** 与 HttpProbeResult.errorCode 中网络层取值同名的常量集合 */
export const NETWORK_REFUSAL_ERROR_CODES = new Set([
  'connection_refused',
  'connection_reset',
  'connection_closed',
  'unreachable',
])

@Injectable()
export class HttpProbeService {
  private readonly logger = new Logger(HttpProbeService.name)

  constructor(private readonly antiDetection: AntiDetectionService) {}

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

    // 获取随机化的请求头
    const randomizedHeaders = this.antiDetection.getRandomizedHeaders()

    // 获取随机代理
    const proxy = this.antiDetection.getRandomProxy()

    const response = await axios.request({
      method,
      url,
      timeout: this.antiDetection.getRequestTimeoutMs(),
      maxRedirects: this.antiDetection.getMaxRedirects(),
      validateStatus: () => true, // Don't throw on 4xx/5xx
      headers: randomizedHeaders,
      onUploadProgress: undefined,
      // 代理配置
      ...(proxy ? { proxy: { host: proxy.split(':')[0], port: parseInt(proxy.split(':')[1]) } } : {}),
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
    const statusCode = axios.isAxiosError(err) && err.response ? err.response.status : null
    const errorCode = statusCode === null ? this.mapAxiosErrorCode(err) : `http_${statusCode}`

    return {
      statusCode,
      finalUrl: url,
      redirectChain: [url],
      latencyMs: Date.now() - start,
      errorCode,
      headFailed,
    }
  }

  /** 将 axios/Node 网络异常映射为 ReasonCode 兼容的标识 */
  private mapAxiosErrorCode(err: any): string {
    const code = err?.code as string | undefined
    const msg = String(err?.message || '')

    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout'
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_failed'
    if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') return 'ssl_error'
    if (code === 'ECONNREFUSED') return 'connection_refused'
    if (code === 'ECONNRESET') return 'connection_reset'
    if (code === 'EPIPE') return 'connection_closed'
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'unreachable'

    // axios 把底层错误塞进 message，需要再识别一次
    if (/socket hang up/i.test(msg)) return 'connection_closed'
    if (/ECONNREFUSED/i.test(msg)) return 'connection_refused'
    if (/ECONNRESET/i.test(msg)) return 'connection_reset'
    if (/EHOSTUNREACH|ENETUNREACH/i.test(msg)) return 'unreachable'

    return 'unknown_error'
  }

  /**
   * 决定是否启动浏览器二次校验。原则：
   *  - HTTP 看起来正常但可能是「软 404」（200/403）—— 上浏览器看真实文本。
   *  - 已知社交/短视频平台对纯 HTTP 客户端常见反爬（404/429/503 / 多跳后无状态码）。
   *  - 任何站点连接级失败（ECONNREFUSED/ECONNRESET 等）—— 用浏览器再试一次，失败则确诊死链。
   *  - 显式超时不再走浏览器（浏览器更慢且大概率同样超时）。
   *  - DNS 失败不走浏览器（无意义）。
   */
  shouldTriggerBrowserFallback(url: string, result: HttpProbeResult): boolean {
    const treatAsSocial = detectPlatform(url) !== null
    const status = result.statusCode
    const err = result.errorCode

    if (status === 200 || status === 403) return true

    if (treatAsSocial && (status === 404 || status === 429 || status === 503)) return true
    if (treatAsSocial && status === null && err !== 'dns_failed' && err !== 'timeout') return true

    if (err && NETWORK_REFUSAL_ERROR_CODES.has(err)) return true

    return false
  }
}
