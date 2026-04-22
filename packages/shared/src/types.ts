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
  finalUrl: string
  redirectChain: string[]
  pageTitle: string | null
  textSnippet: string | null
  screenshotPath: string | null
  platform: PlatformId
  signals: string[]
}

// AI judgement
export interface AiJudgementInput {
  url: string
  platform: PlatformId
  httpStatusCode: number | null
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
