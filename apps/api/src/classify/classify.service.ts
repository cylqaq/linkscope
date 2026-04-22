import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AiService } from '../ai/ai.service'
import {
  detectPlatform,
  type HttpProbeResult,
  type BrowserProbeResult,
  type ClassificationResult,
  type InternalStatus,
  type ReasonCode,
  type FinalStatus,
  type Evidence,
  type AiJudgementInput,
} from '@linkscope/shared'

// Definitive dead HTTP codes
const HARD_DEAD_CODES = new Set([404, 410, 451])
// Auth codes
const AUTH_CODES = new Set([401, 403])
// Transient codes
const TRANSIENT_CODES = new Set([429, 500, 502, 503, 504])

@Injectable()
export class ClassifyService {
  private readonly logger = new Logger(ClassifyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async classify(
    taskUrlId: string,
    url: string,
    http: HttpProbeResult,
    browser: BrowserProbeResult | null,
  ): Promise<ClassificationResult> {
    const platform = detectPlatform(url)

    // Step 1: Rule-based classification
    const ruleResult = this.applyRules(url, http, browser, platform)

    const evidence: Evidence = {
      statusCode: http.statusCode,
      finalUrl: http.finalUrl || browser?.finalUrl || url,
      redirectChain: http.redirectChain,
      pageTitle: browser?.pageTitle ?? null,
      textSnippet: browser?.pageText?.slice(0, 300) ?? null,
      screenshotPath: browser?.screenshotPath ?? null,
      platform: platform?.id ?? 'generic',
      signals: [
        ...(http.errorCode ? [`http_error:${http.errorCode}`] : []),
        ...(browser?.domSignals.map(s => s.signal) ?? []),
      ],
    }

    // Step 2: AI judgement for ambiguous cases
    // Now AI has fetch_url tool, so it can probe even without pre-fetched browser data
    const needsAi = this.shouldUseAi(ruleResult.internalStatus, ruleResult.confidence)

    if (needsAi) {
      try {
        const aiInput: AiJudgementInput = {
          url,
          platform: platform?.id ?? 'generic',
          httpStatusCode: http.statusCode,
          finalUrl: http.finalUrl || browser?.finalUrl || url,
          pageTitle: browser?.pageTitle ?? null,
          pageTextSnippet: browser?.pageText ?? null,
          domSignals: browser?.domSignals ?? [],
          redirectChain: http.redirectChain,
        }

        const { output, latencyMs, tokenUsage, modelName, toolCallsUsed } = await this.ai.judge(aiInput)

        // Save AI judgement
        await this.prisma.aiJudgement.upsert({
          where: { taskUrlId },
          create: {
            taskUrlId,
            modelName,
            promptVersion: this.ai.promptVersion,
            inputSummary: {
              url,
              platform: platform?.id,
              httpStatusCode: http.statusCode,
              pageTitle: browser?.pageTitle,
              textLength: browser?.pageText?.length ?? 0,
              toolCallsUsed,
            },
            decision: output.decision,
            reasoning: output.reasoning,
            confidence: output.confidence,
            latencyMs,
            tokenUsage,
          },
          update: {
            decision: output.decision,
            reasoning: output.reasoning,
            confidence: output.confidence,
            latencyMs,
          },
        })

        // Fuse AI result with rules
        const fused = this.fuseAiWithRules(ruleResult, output)
        return {
          ...fused,
          evidence,
          sourceOfTruth: 'rule_plus_ai',
        }
      } catch (err) {
        this.logger.warn(`AI classification failed for ${url}: ${err}`)
      }
    }

    return {
      ...ruleResult,
      evidence,
      sourceOfTruth: 'rule_only',
      retryStrategy: this.getRetryStrategy(ruleResult.internalStatus),
    }
  }

  private applyRules(
    url: string,
    http: HttpProbeResult,
    browser: BrowserProbeResult | null,
    platform: ReturnType<typeof detectPlatform>,
  ): Omit<ClassificationResult, 'evidence' | 'sourceOfTruth'> {
    const code = http.statusCode

    // Hard HTTP dead codes
    if (code && HARD_DEAD_CODES.has(code)) {
      return {
        finalStatus: 'dead_link',
        internalStatus: code === 410 ? 'gone_410' : code === 451 ? 'legal_451' : 'hard_404',
        reasonCode: `http_${code}` as ReasonCode,
        confidence: 0.98,
        retryStrategy: 'no_retry',
        needsReview: false,
      }
    }

    // DNS / SSL errors → dead
    if (http.errorCode === 'dns_failed') {
      return {
        finalStatus: 'dead_link',
        internalStatus: 'removed',
        reasonCode: 'dns_failed',
        confidence: 0.95,
        retryStrategy: 'no_retry',
        needsReview: false,
      }
    }

    // Timeout → transient
    if (http.errorCode === 'timeout') {
      return {
        finalStatus: 'review_required',
        internalStatus: 'transient_error',
        reasonCode: 'timeout',
        confidence: 0.5,
        retryStrategy: 'retry_with_backoff',
        needsReview: false,
      }
    }

    // Auth codes
    if (code && AUTH_CODES.has(code)) {
      return {
        finalStatus: 'review_required',
        internalStatus: code === 401 ? 'login_required' : 'forbidden',
        reasonCode: code === 401 ? 'auth_401' : 'auth_403',
        confidence: 0.8,
        retryStrategy: 'need_login',
        needsReview: true,
      }
    }

    // Transient server errors
    if (code && TRANSIENT_CODES.has(code)) {
      return {
        finalStatus: 'review_required',
        internalStatus: 'transient_error',
        reasonCode: `http_${code}` as ReasonCode,
        confidence: 0.5,
        retryStrategy: 'retry_with_backoff',
        needsReview: false,
      }
    }

    // Platform-specific pattern matching (if browser probe available)
    if (browser && platform) {
      const text = (browser.pageText ?? '') + (browser.pageTitle ?? '')
      
      for (const pattern of platform.deadPatterns) {
        if (pattern.test(text)) {
          return {
            finalStatus: 'dead_link',
            internalStatus: 'soft_404',
            reasonCode: 'removed_pattern',
            confidence: 0.92,
            retryStrategy: 'no_retry',
            needsReview: false,
          }
        }
      }

      for (const pattern of platform.loginPatterns) {
        if (pattern.test(text)) {
          return {
            finalStatus: 'review_required',
            internalStatus: 'login_required',
            reasonCode: 'auth_401',
            confidence: 0.85,
            retryStrategy: 'need_login',
            needsReview: true,
          }
        }
      }

      for (const pattern of platform.privatePatterns) {
        if (pattern.test(text)) {
          return {
            finalStatus: 'dead_link',
            internalStatus: 'removed',
            reasonCode: 'account_banned',
            confidence: 0.88,
            retryStrategy: 'no_retry',
            needsReview: false,
          }
        }
      }
    }

    // DOM signals from browser probe
    if (browser?.domSignals.length) {
      return {
        finalStatus: 'dead_link',
        internalStatus: 'soft_404',
        reasonCode: 'soft_404_text',
        confidence: 0.85,
        retryStrategy: 'no_retry',
        needsReview: false,
      }
    }

    // Redirect to homepage / root detection
    if (http.redirectChain.length > 1) {
      const finalPath = (() => {
        try { return new URL(http.finalUrl || url).pathname } catch { return '/' }
      })()
      if (finalPath === '/' || finalPath === '') {
        return {
          finalStatus: 'dead_link',
          internalStatus: 'soft_404',
          reasonCode: 'redirect_to_home',
          confidence: 0.75,
          retryStrategy: 'no_retry',
          needsReview: true,
        }
      }
    }

    // HTTP 200 without browser probe → likely accessible but needs AI confirm
    if (code === 200) {
      return {
        finalStatus: 'accessible',
        internalStatus: 'ok',
        reasonCode: 'http_200_ok',
        confidence: 0.75,
        retryStrategy: 'no_retry',
        needsReview: false,
      }
    }

    // Unknown
    return {
      finalStatus: 'review_required',
      internalStatus: 'unknown',
      reasonCode: 'unknown',
      confidence: 0.4,
      retryStrategy: 'no_retry',
      needsReview: true,
    }
  }

  private shouldUseAi(status: InternalStatus, confidence: number): boolean {
    // Use AI for ambiguous cases or low confidence
    const ambiguousStatuses: InternalStatus[] = ['ok', 'soft_404', 'unknown', 'forbidden', 'risk_blocked']
    return ambiguousStatuses.includes(status) || confidence < 0.85
  }

  private fuseAiWithRules(
    rule: Omit<ClassificationResult, 'evidence' | 'sourceOfTruth'>,
    ai: { decision: string; internalStatus: InternalStatus; reasonCode: ReasonCode; confidence: number; reasoning: string; nextAction: string },
  ): Omit<ClassificationResult, 'evidence' | 'sourceOfTruth'> {
    const AI_WEIGHT = 0.8

    // If rule is very confident, keep rule
    if (rule.confidence >= 0.9) return rule

    // If AI and rule agree
    if (ai.decision === rule.finalStatus) {
      return {
        ...rule,
        confidence: Math.min(1, (rule.confidence + ai.confidence * AI_WEIGHT) / 2 + 0.1),
      }
    }

    // If AI is highly confident and rule is not
    if (ai.confidence >= 0.85 && rule.confidence < 0.75) {
      return {
        finalStatus: ai.decision as FinalStatus,
        internalStatus: ai.internalStatus,
        reasonCode: ai.reasonCode,
        confidence: ai.confidence * AI_WEIGHT,
        retryStrategy: ai.nextAction as any,
        needsReview: ai.confidence < 0.9,
      }
    }

    // Default: blend with rule taking precedence
    return {
      ...rule,
      confidence: (rule.confidence * 0.6 + ai.confidence * 0.4),
      needsReview: true,
    }
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
