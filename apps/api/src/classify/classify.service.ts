import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AiService } from '../ai/ai.service'
import { NETWORK_REFUSAL_ERROR_CODES } from '../probe/http-probe.service'
import {
  detectPlatform,
  canonicalizeFinalUrl,
  stripTrackingParams,
  type HttpProbeResult,
  type BrowserProbeResult,
  type ClassificationResult,
  type InternalStatus,
  type ReasonCode,
  type FinalStatus,
  type Evidence,
  type AiVerdict,
  type AiJudgementInput,
  type AiJudgementOutput,
} from '@linkscope/shared'

const HARD_DEAD_HTTP_CODES = new Set([404, 410, 451])
const AUTH_HTTP_CODES = new Set([401, 403])
const TRANSIENT_HTTP_CODES = new Set([429, 500, 502, 503, 504])

const NET_REASON_BY_ERR: Record<string, ReasonCode> = {
  connection_refused: 'connection_refused',
  connection_reset: 'connection_reset',
  connection_closed: 'connection_closed',
  unreachable: 'unreachable',
}

type RuleVerdict = Omit<ClassificationResult, 'evidence' | 'sourceOfTruth'>

type AiUseDecision =
  | { use: false; reason: 'rule_confident' | 'not_eligible' }
  | {
      use: true
      /** 触发 AI 的高层动机；用于在前端/日志里说明「为什么调用 AI」 */
      reason: 'http_status_conflict' | 'connection_failure_double_check' | 'low_confidence' | 'ambiguous_status'
    }

@Injectable()
export class ClassifyService {
  private readonly logger = new Logger(ClassifyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  // ---------- 入口 ----------

  async classify(
    taskUrlId: string,
    url: string,
    http: HttpProbeResult,
    browser: BrowserProbeResult | null,
  ): Promise<ClassificationResult> {
    const platform = detectPlatform(url)
    const ruleResult = this.applyRules(url, http, browser, platform)

    const aiDecision = this.decideAiUse(ruleResult, http, browser)

    const baseEvidence = this.buildEvidence(url, http, browser, platform, ruleResult)

    let result: ClassificationResult

    if (!aiDecision.use) {
      result = {
        ...ruleResult,
        evidence: { ...baseEvidence, aiVerdict: { state: 'skipped', reason: aiDecision.reason } },
        sourceOfTruth: 'rule_only',
        retryStrategy: this.getRetryStrategy(ruleResult.internalStatus),
      }
    } else {
      const aiOutcome = await this.runAi(
        taskUrlId,
        url,
        platform?.id ?? 'generic',
        http,
        browser,
        baseEvidence.finalUrl,
        aiDecision.reason,
      )

      if (!aiOutcome.succeeded) {
        result = {
          ...ruleResult,
          evidence: {
            ...baseEvidence,
            aiVerdict: { state: 'failed', reason: aiOutcome.failureReason },
          },
          sourceOfTruth: 'rule_only',
          retryStrategy: this.getRetryStrategy(ruleResult.internalStatus),
        }
      } else {
        const fused = this.fuseAiWithRules(ruleResult, aiOutcome.output, aiDecision.reason)
        const verdict: AiVerdict =
          aiOutcome.output.decision === ruleResult.finalStatus
            ? { state: 'agree', reasoning: aiOutcome.output.reasoning, confidence: aiOutcome.output.confidence }
            : {
                state: 'disagree',
                reasoning: aiOutcome.output.reasoning,
                confidence: aiOutcome.output.confidence,
                decision: aiOutcome.output.decision,
              }

        result = {
          ...fused,
          evidence: { ...baseEvidence, verifiedBy: 'ai', aiVerdict: verdict },
          sourceOfTruth: 'rule_plus_ai',
        }
      }
    }

    await this.maybeRecordUserHintHits(browser, result.reasonCode)
    return result
  }

  private hasUserScreenHint(browser: BrowserProbeResult): boolean {
    return browser.domSignals.some(s => s.signal === 'user_screen_hint')
  }

  private async maybeRecordUserHintHits(
    browser: BrowserProbeResult | null,
    reasonCode: ReasonCode,
  ): Promise<void> {
    if (!browser || reasonCode !== 'user_screen_hint') return
    const ids = [
      ...new Set(
        browser.domSignals
          .filter(s => s.signal === 'user_screen_hint' && s.hintId)
          .map(s => s.hintId as string),
      ),
    ]
    for (const id of ids) {
      await this.prisma.screenHint
        .update({ where: { id }, data: { hitCount: { increment: 1 } } })
        .catch(() => {})
    }
  }

  // ---------- 规则层 ----------

  private applyRules(
    url: string,
    http: HttpProbeResult,
    browser: BrowserProbeResult | null,
    platform: ReturnType<typeof detectPlatform>,
  ): RuleVerdict {
    const code = http.statusCode
    const err = http.errorCode

    // 1) 反爬 404 / 登录墙：在 HARD dead 之前先识别
    if (code === 404) {
      if (this.isFalsePositiveHttp404(http, browser, platform)) {
        return ruleAccessible('platform_detected', 0.9)
      }
      if (this.browserSuggestsLoginWall(browser, platform)) {
        return ruleReview('login_required', 'auth_401', 0.82, 'need_login', true)
      }
    }

    // 2) HTTP 死码：404 在上方未被反转时也归这里
    if (code !== null && HARD_DEAD_HTTP_CODES.has(code)) {
      const internal: InternalStatus = code === 410 ? 'gone_410' : code === 451 ? 'legal_451' : 'hard_404'
      return ruleDead(internal, `http_${code}` as ReasonCode, 0.98)
    }

    // 3) 网络拒连：浏览器一并失败 → 高置信死链；浏览器成功打开 → 看内容是否真可访问
    if (err && NETWORK_REFUSAL_ERROR_CODES.has(err)) {
      const browserAlsoRefused = !!browser?.errorCode && NETWORK_REFUSAL_ERROR_CODES.has(browser.errorCode)
      if (browserAlsoRefused) {
        return ruleDead('removed', NET_REASON_BY_ERR[err], 0.95)
      }
      if (browser && !browser.errorCode) {
        // 浏览器能打开页面 — 先检查内容是否为下架/删除/封禁
        if (this.browserShowsDeadContent(browser, platform)) {
          return ruleDead('removed', 'removed_pattern', 0.85)
        }
        if (this.browserHasMeaningfulContent(browser)) {
          return ruleAccessible('platform_detected', 0.85)
        }
      }
      // 浏览器未跑或不确定：候选死链，留给 AI 复核
      return {
        finalStatus: 'dead_link',
        internalStatus: 'removed',
        reasonCode: NET_REASON_BY_ERR[err],
        confidence: 0.7,
        retryStrategy: 'no_retry',
        needsReview: true,
      }
    }

    // 4) DNS：基本是删站 / 拼错域名
    if (err === 'dns_failed') {
      return ruleDead('removed', 'dns_failed', 0.95)
    }

    // 5) SSL：异常但偶有运维过期，归复核
    if (err === 'ssl_error') {
      return ruleReview('transient_error', 'ssl_error', 0.6, 'retry_with_backoff', true)
    }

    // 6) 超时：偶发，给 AI 兜底
    if (err === 'timeout') {
      return ruleReview('transient_error', 'timeout', 0.5, 'retry_with_backoff', false)
    }

    // 7) 鉴权
    if (code !== null && AUTH_HTTP_CODES.has(code)) {
      return ruleReview(
        code === 401 ? 'login_required' : 'forbidden',
        code === 401 ? 'auth_401' : 'auth_403',
        0.8,
        'need_login',
        true,
      )
    }

    // 8) 服务暂态错误
    if (code !== null && TRANSIENT_HTTP_CODES.has(code)) {
      return ruleReview('transient_error', `http_${code}` as ReasonCode, 0.5, 'retry_with_backoff', false)
    }

    // 9) 平台/DOM 文案识别（仅在浏览器有探测结果时）
    if (browser && platform) {
      const text = (browser.pageText ?? '') + (browser.pageTitle ?? '')

      for (const pattern of platform.deadPatterns) {
        if (pattern.test(text)) return ruleDead('removed', 'removed_pattern', 0.92)
      }
      for (const pattern of platform.loginPatterns) {
        if (pattern.test(text)) return ruleReview('login_required', 'auth_401', 0.85, 'need_login', true)
      }
      for (const pattern of platform.privatePatterns) {
        if (pattern.test(text)) return ruleDead('removed', 'account_banned', 0.88)
      }
      for (const pattern of platform.regionPatterns) {
        if (pattern.test(text)) return ruleReview('forbidden', 'region_restricted', 0.8, 'no_retry', true)
      }
    }

    if (browser && this.hasUserScreenHint(browser)) {
      return ruleDead('removed', 'user_screen_hint', 0.94)
    }

    if (browser?.domSignals.some(s => s.signal === 'network_api_removed')) {
      return ruleDead('removed', 'network_json_removed', 0.91)
    }

    if (browser?.domSignals.some(s => s.signal === 'dead_content_text')) {
      return ruleDead('soft_404', 'soft_404_text', 0.85)
    }

    // 14) 纯 HTTP 重定向到根域 — 浏览器没证明实质内容时判死
    if (http.redirectChain.length > 1 && this.redirectsToRoot(http.finalUrl || url) && !this.browserLooksHealthy(browser, platform)) {
      return {
        finalStatus: 'dead_link',
        internalStatus: 'soft_404',
        reasonCode: 'redirect_to_home',
        confidence: 0.75,
        retryStrategy: 'no_retry',
        needsReview: true,
      }
    }

    // 15) HTTP 200 — 默认可访问；置信不到 0.9 会触发 AI 复核
    if (code === 200) {
      return ruleAccessible('http_200_ok', 0.75)
    }

    // 16) 兜底：未知
    return {
      finalStatus: 'review_required',
      internalStatus: 'unknown',
      reasonCode: 'unknown',
      confidence: 0.4,
      retryStrategy: 'no_retry',
      needsReview: true,
    }
  }

  // ---------- AI 调度 ----------

  /** 是否调用 AI 复核 — 由 (规则结果, HTTP, 浏览器) 共同决定 */
  private decideAiUse(rule: RuleVerdict, http: HttpProbeResult, browser: BrowserProbeResult | null): AiUseDecision {
    // 反爬覆盖：HTTP 4xx 但规则升级为 accessible — 必须让 AI 看一眼真实页面
    const httpStatusContradicts =
      typeof http.statusCode === 'number' &&
      http.statusCode >= 400 &&
      rule.finalStatus === 'accessible'
    if (httpStatusContradicts) return { use: true, reason: 'http_status_conflict' }

    // 网络拒连/超时类：让 AI 用 fetch_url_rendered 真实验证一次
    const err = http.errorCode
    if (err === 'timeout' || (err && NETWORK_REFUSAL_ERROR_CODES.has(err))) {
      return { use: true, reason: 'connection_failure_double_check' }
    }

    // 高置信规则：跳过 AI
    if (rule.confidence >= 0.9) return { use: false, reason: 'rule_confident' }

    const ambiguous: InternalStatus[] = ['soft_404', 'unknown', 'forbidden', 'risk_blocked']
    if (ambiguous.includes(rule.internalStatus)) return { use: true, reason: 'ambiguous_status' }

    if (rule.confidence < 0.85) return { use: true, reason: 'low_confidence' }

    return { use: false, reason: 'not_eligible' }
  }

  private async runAi(
    taskUrlId: string,
    url: string,
    platformId: string,
    http: HttpProbeResult,
    browser: BrowserProbeResult | null,
    finalUrl: string,
    triggerReason: Extract<AiUseDecision, { use: true }>['reason'],
  ): Promise<
    | { succeeded: true; output: AiJudgementOutput }
    | { succeeded: false; failureReason: string }
  > {
    const aiInput: AiJudgementInput = {
      url,
      platform: platformId as any,
      httpStatusCode: http.statusCode,
      httpErrorCode: http.errorCode,
      triggerReason,
      finalUrl,
      pageTitle: browser?.pageTitle ?? null,
      pageTextSnippet: browser?.pageText ?? null,
      domSignals: browser?.domSignals ?? [],
      networkSamples: browser?.networkSamples?.length ? browser.networkSamples : undefined,
      redirectChain: http.redirectChain,
    }

    const result = await this.ai.judge(aiInput).catch(err => {
      this.logger.warn(`AI judge threw for ${url}: ${err}`)
      return null
    })

    if (!result) return { succeeded: false, failureReason: 'AI 调用异常' }
    if (!result.succeeded) return { succeeded: false, failureReason: result.failureReason ?? 'AI 调用失败' }

    await this.prisma.aiJudgement
      .upsert({
        where: { taskUrlId },
        create: {
          taskUrlId,
          modelName: result.modelName,
          promptVersion: this.ai.promptVersion,
          inputSummary: {
            url,
            platform: platformId,
            httpStatusCode: http.statusCode,
            httpErrorCode: http.errorCode,
            pageTitle: browser?.pageTitle,
            textLength: browser?.pageText?.length ?? 0,
            toolCallsUsed: result.toolCallsUsed,
          },
          decision: result.output.decision,
          reasoning: result.output.reasoning,
          confidence: result.output.confidence,
          latencyMs: result.latencyMs,
          tokenUsage: result.tokenUsage,
        },
        update: {
          decision: result.output.decision,
          reasoning: result.output.reasoning,
          confidence: result.output.confidence,
          latencyMs: result.latencyMs,
        },
      })
      .catch(err => this.logger.warn(`Save aiJudgement failed: ${err}`))

    return { succeeded: true, output: result.output }
  }

  // ---------- 规则 + AI 融合 ----------

  /**
   * 规则结果与 AI 输出融合。融合策略与「为什么找 AI」相关：
   *   - http_status_conflict：规则违反了 HTTP 表面信号；AI 不同意时回退到 review_required。
   *   - connection_failure_double_check：网络拒连，AI 若证明可访问则反转为 accessible。
   *   - 其他场景：AI 明显更有把握就替换规则，否则做加权融合。
   */
  private fuseAiWithRules(rule: RuleVerdict, ai: AiJudgementOutput, why: AiUseDecision['reason']): RuleVerdict {
    if (ai.decision === rule.finalStatus) {
      return {
        ...rule,
        confidence: Math.min(1, (rule.confidence + ai.confidence) / 2 + 0.05),
        needsReview: false,
      }
    }

    if (why === 'http_status_conflict') {
      // 规则升级为 accessible，但 AI 看完真实页面后否定
      return {
        finalStatus: 'review_required',
        internalStatus: ai.internalStatus,
        reasonCode: ai.reasonCode,
        confidence: Math.max(0.5, ai.confidence),
        retryStrategy: ai.nextAction,
        needsReview: true,
      }
    }

    if (why === 'connection_failure_double_check' && ai.decision === 'accessible' && ai.confidence >= 0.7) {
      return {
        finalStatus: 'accessible',
        internalStatus: 'ok',
        reasonCode: 'platform_detected',
        confidence: Math.min(0.9, ai.confidence),
        retryStrategy: 'no_retry',
        needsReview: false,
      }
    }

    if (ai.confidence >= 0.85 && rule.confidence < 0.75) {
      return {
        finalStatus: ai.decision,
        internalStatus: ai.internalStatus,
        reasonCode: ai.reasonCode,
        confidence: ai.confidence * 0.85,
        retryStrategy: ai.nextAction,
        needsReview: ai.confidence < 0.9,
      }
    }

    return {
      ...rule,
      confidence: rule.confidence * 0.6 + ai.confidence * 0.4,
      needsReview: true,
    }
  }

  // ---------- 证据组装 ----------

  private buildEvidence(
    url: string,
    http: HttpProbeResult,
    browser: BrowserProbeResult | null,
    platform: ReturnType<typeof detectPlatform>,
    ruleResult: RuleVerdict,
  ): Evidence {
    const httpFinalUrl = http.finalUrl || null
    const browserFinalUrl = browser?.finalUrl || null

    const pickRaw = (() => {
      if (this.isUsefulFinalUrl(browserFinalUrl)) return browserFinalUrl as string
      if (this.isUsefulFinalUrl(httpFinalUrl)) return httpFinalUrl as string
      return browserFinalUrl || httpFinalUrl || url
    })()
    const finalUrl = canonicalizeFinalUrl(pickRaw)

    const signals = [
      ...(http.errorCode ? [`http_error:${http.errorCode}`] : []),
      ...(browser?.errorCode ? [`browser_error:${browser.errorCode}`] : []),
      ...(browser?.domSignals.map(s => s.signal) ?? []),
    ]
    if (browser?.networkSamples?.length) {
      signals.push(`network_xhr:${browser.networkSamples.length}`)
    }

    let verifiedBy: Evidence['verifiedBy'] = 'rule'
    if (browser && !browser.errorCode) {
      verifiedBy = 'browser'
    } else if (typeof http.statusCode === 'number' && http.statusCode >= 200 && http.statusCode < 400) {
      verifiedBy = 'http'
    }

    let verificationNote: string | null = null
    const httpStatusContradicts =
      typeof http.statusCode === 'number' &&
      http.statusCode >= 400 &&
      ruleResult.finalStatus === 'accessible'
    if (httpStatusContradicts) {
      verificationNote = `HTTP 层返回 ${http.statusCode}（疑似反爬），浏览器渲染后内容可正常访问`
      signals.push('browser_verified_accessible')
    }
    if (http.errorCode && NETWORK_REFUSAL_ERROR_CODES.has(http.errorCode)) {
      const browserAlsoRefused = browser?.errorCode && NETWORK_REFUSAL_ERROR_CODES.has(browser.errorCode)
      if (ruleResult.finalStatus === 'dead_link' && browserAlsoRefused) {
        verificationNote = `HTTP 与浏览器层均报 ${http.errorCode}，站点已无法连接`
      } else if (ruleResult.finalStatus === 'dead_link') {
        verificationNote = `HTTP 层报 ${http.errorCode}（连接被拒绝/重置），等待 AI 复核`
      }
    }

    return {
      statusCode: http.statusCode,
      finalUrl,
      httpFinalUrl: httpFinalUrl ? stripTrackingParams(httpFinalUrl) : null,
      browserFinalUrl: browserFinalUrl ? stripTrackingParams(browserFinalUrl) : null,
      redirectChain: http.redirectChain,
      pageTitle: browser?.pageTitle ?? null,
      textSnippet: browser?.pageText?.slice(0, 300) ?? null,
      screenshotPath: browser?.screenshotPath ?? null,
      platform: platform?.id ?? 'generic',
      signals,
      verifiedBy,
      verificationNote,
      ...(browser?.networkSamples?.length ? { networkSamples: browser.networkSamples } : {}),
    }
  }

  // ---------- 工具函数 ----------

  private isUsefulFinalUrl(u: string | null): boolean {
    if (!u) return false
    try {
      const parsed = new URL(u)
      if (parsed.protocol === 'about:') return false
      const path = parsed.pathname
      return !!path && path !== '/' && path !== ''
    } catch {
      return false
    }
  }

  private redirectsToRoot(finalUrl: string): boolean {
    try {
      const path = new URL(finalUrl).pathname
      return path === '/' || path === ''
    } catch {
      return true
    }
  }

  private browserHasMeaningfulContent(browser: BrowserProbeResult): boolean {
    const text = (browser.pageText ?? '').trim()
    if (text.length >= 80) return true
    if ((browser.pageTitle ?? '').trim().length >= 4) return true
    return false
  }

  /** 浏览器页面是否显示下架/删除/封禁等死链内容 */
  private browserShowsDeadContent(
    browser: BrowserProbeResult,
    platform: ReturnType<typeof detectPlatform>,
  ): boolean {
    if (browser.domSignals.some(s =>
      s.signal === 'dead_content_text' || s.signal === 'user_screen_hint' || s.signal === 'network_api_removed'
    )) {
      return true
    }
    if (platform) {
      const text = (browser.pageText ?? '') + (browser.pageTitle ?? '')
      for (const pattern of [...platform.deadPatterns, ...platform.privatePatterns, ...platform.regionPatterns]) {
        if (pattern.test(text)) return true
      }
    }
    return false
  }

  private isFalsePositiveHttp404(
    http: HttpProbeResult,
    browser: BrowserProbeResult | null,
    platform: ReturnType<typeof detectPlatform>,
  ): boolean {
    if (http.statusCode !== 404 || !browser || browser.errorCode) return false
    if (!platform) return false

    const text = (browser.pageText ?? '') + (browser.pageTitle ?? '')
    for (const pattern of platform.deadPatterns) {
      if (pattern.test(text)) return false
    }
    for (const pattern of platform.privatePatterns) {
      if (pattern.test(text)) return false
    }
    for (const pattern of platform.regionPatterns) {
      if (pattern.test(text)) return false
    }
    if (browser.domSignals.some(s => s.signal === 'dead_content_text' || s.signal === 'user_screen_hint' || s.signal === 'network_api_removed')) {
      return false
    }

    if (text.trim().length >= 120) return true

    try {
      const u = new URL(browser.finalUrl || '')
      if (platform.id === 'douyin' && /\/(video|note)\/\d+/.test(u.pathname)) return true
      if (platform.id === 'bilibili' && /\/video\//.test(u.pathname)) return true
      const segments = u.pathname.split('/').filter(Boolean)
      if (segments.length >= 2 && u.pathname.length > 24) return true
    } catch {
      // ignore
    }
    return false
  }

  private browserLooksHealthy(
    browser: BrowserProbeResult | null,
    platform: ReturnType<typeof detectPlatform>,
  ): boolean {
    if (!browser || browser.errorCode) return false
    if (browser.domSignals.some(s => s.signal === 'dead_content_text' || s.signal === 'user_screen_hint' || s.signal === 'network_api_removed')) {
      return false
    }

    const text = (browser.pageText ?? '') + (browser.pageTitle ?? '')
    if (platform) {
      for (const pattern of platform.deadPatterns) {
        if (pattern.test(text)) return false
      }
      for (const pattern of platform.privatePatterns) {
        if (pattern.test(text)) return false
      }
      for (const pattern of platform.regionPatterns) {
        if (pattern.test(text)) return false
      }
    }
    if (text.trim().length >= 100) return true
    try {
      const u = new URL(browser.finalUrl || '')
      if (platform?.id === 'douyin' && /\/(video|note)\/\d+/.test(u.pathname)) return true
      if (platform?.id === 'bilibili' && /\/video\/(BV[\w]+|\d+)/i.test(u.pathname)) return true
    } catch {
      // ignore
    }
    return false
  }

  private browserSuggestsLoginWall(
    browser: BrowserProbeResult | null,
    platform: ReturnType<typeof detectPlatform>,
  ): boolean {
    if (!browser || browser.errorCode) return false
    const text = (browser.pageText ?? '') + (browser.pageTitle ?? '')
    if (platform) {
      for (const pattern of platform.loginPatterns) {
        if (pattern.test(text)) return true
      }
    }
    return /请登录|扫码登录|验证后查看|安全验证/i.test(text)
  }

  private getRetryStrategy(status: InternalStatus): ClassificationResult['retryStrategy'] {
    const map: Partial<Record<InternalStatus, ClassificationResult['retryStrategy']>> = {
      transient_error: 'retry_with_backoff',
      login_required: 'need_login',
      rate_limited: 'retry_with_backoff',
      risk_blocked: 'need_adapter',
      unknown: 'no_retry',
    }
    return map[status] ?? 'no_retry'
  }
}

// ---------- RuleVerdict 工厂（避免上面规则函数中重复字面量） ----------

function ruleAccessible(reasonCode: ReasonCode, confidence: number): RuleVerdict {
  return {
    finalStatus: 'accessible',
    internalStatus: 'ok',
    reasonCode,
    confidence,
    retryStrategy: 'no_retry',
    needsReview: false,
  }
}

function ruleDead(internalStatus: InternalStatus, reasonCode: ReasonCode, confidence: number): RuleVerdict {
  return {
    finalStatus: 'dead_link',
    internalStatus,
    reasonCode,
    confidence,
    retryStrategy: 'no_retry',
    needsReview: false,
  }
}

function ruleReview(
  internalStatus: InternalStatus,
  reasonCode: ReasonCode,
  confidence: number,
  retryStrategy: ClassificationResult['retryStrategy'],
  needsReview: boolean,
): RuleVerdict {
  return {
    finalStatus: 'review_required',
    internalStatus,
    reasonCode,
    confidence,
    retryStrategy,
    needsReview,
  }
}
