// Core result status types
export type FinalStatus = 'accessible' | 'dead_link' | 'review_required'

export type InternalStatus =
  | 'ok'
  | 'removed'
  | 'soft_404'
  | 'hard_404'
  | 'gone_410'
  | 'legal_451'
  | 'login_required'
  | 'forbidden'
  | 'rate_limited'
  | 'transient_error'
  | 'risk_blocked'
  | 'unknown'

export type ReasonCode =
  | 'http_200_ok'
  | 'http_404'
  | 'http_410'
  | 'http_451'
  | 'auth_401'
  | 'auth_403'
  | 'soft_404_text'
  | 'soft_404_ai'
  | 'removed_pattern'
  | 'video_removed'
  | 'account_private'
  | 'account_banned'
  | 'region_restricted'
  | 'content_deleted'
  | 'timeout'
  | 'dns_failed'
  | 'ssl_error'
  | 'connection_refused'
  | 'connection_reset'
  | 'connection_closed'
  | 'unreachable'
  | 'blocked_by_waf'
  | 'redirect_to_home'
  | 'redirect_to_error'
  | 'platform_detected'
  | 'unknown'

export type RetryStrategy = 'no_retry' | 'retry_with_backoff' | 'need_login' | 'need_adapter' | 'send_to_agent'

export type SourceOfTruth = 'rule_only' | 'rule_plus_ai' | 'adapter' | 'local_agent'

export type PlatformId =
  | 'douyin'
  | 'toutiao'
  | 'kuaishou'
  | 'xiaohongshu'
  | 'bilibili'
  | 'weibo'
  | 'huoshan'
  | 'baijiahao'
  | 'xigua'
  | 'duxiaoshi'
  | 'dongchedi'
  | 'haokan'
  | 'dayu'
  | 'weixin_channels'
  | 'pipixia'
  | 'wangyi_video'
  | 'weishi'
  | 'tencent_news'
  | 'souhu_video'
  | 'yangshipin'
  | 'generic'

// Task types
export type TaskStatus = 'queued' | 'running' | 'partial_done' | 'completed' | 'failed'

export interface CreateTaskInput {
  urls?: string[]
  name?: string
}

export interface TaskSummary {
  id: string
  name: string | null
  status: TaskStatus
  totalUrls: number
  completedUrls: number
  accessibleCount: number
  deadLinkCount: number
  reviewCount: number
  createdAt: string
  completedAt: string | null
}

// Probe result types
export interface HttpProbeResult {
  statusCode: number | null
  finalUrl: string
  redirectChain: string[]
  latencyMs: number
  errorCode: string | null
  headFailed: boolean
}

export interface BrowserProbeResult {
  pageTitle: string | null
  pageText: string | null
  finalUrl: string
  screenshotPath: string | null
  domSignals: DomSignal[]
  errorCode: string | null
}

export interface DomSignal {
  type: 'text_match' | 'element_exists' | 'page_structure'
  signal: string
  value: string
}

// Classification result
export interface ClassificationResult {
  finalStatus: FinalStatus
  internalStatus: InternalStatus
  reasonCode: ReasonCode
  confidence: number
  retryStrategy: RetryStrategy
  sourceOfTruth: SourceOfTruth
  evidence: Evidence
  needsReview: boolean
}

export interface Evidence {
  statusCode: number | null
  /** 展示给用户的最终 URL：浏览器层优先 + canonical + 去追踪参数 */
  finalUrl: string
  /** HTTP 层原始 finalUrl（含追踪参数），供排查使用 */
  httpFinalUrl?: string | null
  /** 浏览器层原始 finalUrl（含追踪参数） */
  browserFinalUrl?: string | null
  redirectChain: string[]
  pageTitle: string | null
  textSnippet: string | null
  screenshotPath: string | null
  platform: PlatformId
  signals: string[]
  /** 最终结论的「校验层」来源；用于前端展示"已浏览器校验"等 */
  verifiedBy?: 'http' | 'browser' | 'ai' | 'rule'
  /** HTTP 与最终结论冲突时（如 HTTP 404 → 实际可访问），给出可读说明 */
  verificationNote?: string | null
  /** AI 复核状态：见 AiVerdict */
  aiVerdict?: AiVerdict
}

/** AI 复核结论 — 让前端确实看到「AI 是否参与/是否赞同规则」 */
export type AiVerdict =
  | { state: 'agree'; reasoning: string; confidence: number }
  | { state: 'disagree'; reasoning: string; confidence: number; decision: 'accessible' | 'dead_link' | 'review_required' }
  | { state: 'skipped'; reason: 'rule_confident' | 'not_eligible' }
  | { state: 'failed'; reason: string }

// AI judgement
export interface AiJudgementInput {
  url: string
  platform: PlatformId
  httpStatusCode: number | null
  /** HTTP 层错误码（dns_failed / connection_refused / timeout 等），帮 AI 选择探测工具 */
  httpErrorCode?: string | null
  /** 触发 AI 复核的高层原因，便于 AI 选对策略 */
  triggerReason?: 'http_status_conflict' | 'connection_failure_double_check' | 'low_confidence' | 'ambiguous_status'
  finalUrl: string
  pageTitle: string | null
  pageTextSnippet: string | null
  domSignals: DomSignal[]
  redirectChain: string[]
}

export interface AiJudgementOutput {
  decision: 'accessible' | 'dead_link' | 'review_required'
  internalStatus: InternalStatus
  reasonCode: ReasonCode
  confidence: number
  reasoning: string
  nextAction: RetryStrategy
}

// URL result item (API response)
export interface UrlResult {
  id: string
  taskId: string
  originalUrl: string
  normalizedUrl: string
  platform: PlatformId
  finalStatus: FinalStatus
  internalStatus: InternalStatus
  reasonCode: ReasonCode
  confidence: number
  sourceOfTruth: SourceOfTruth
  needsReview: boolean
  evidence: Evidence
  createdAt: string
  completedAt: string | null
}
