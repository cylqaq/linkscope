'use client'

import { useState } from 'react'
import QuickHintFromResult from '@/components/results/QuickHintFromResult'
import { getWebVisibleApiRoot } from '@/lib/api'

const STATUS_CONFIG = {
  accessible: { label: '正常', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  dead_link: { label: '失效', color: 'text-red-400', dot: 'bg-red-400' },
  review_required: { label: '复核', color: 'text-amber-400', dot: 'bg-amber-400' },
} as const

const REASON_LABEL: Record<string, string> = {
  http_200_ok: 'HTTP 200 正常',
  http_404: '404 页面不存在',
  http_410: '410 已永久删除',
  http_451: '451 法律限制',
  auth_401: '需要登录',
  auth_403: '无权限',
  soft_404_text: '软 404（文本）',
  soft_404_ai: '软 404（AI）',
  user_screen_hint: '自定义屏幕提示（下架/失效）',
  network_json_removed: '接口节选（下架/删除）',
  removed_pattern: '平台下架',
  video_removed: '视频已删除',
  account_private: '账号私密',
  account_banned: '账号封禁',
  region_restricted: '地区限制',
  content_deleted: '内容删除',
  timeout: '连接超时',
  dns_failed: 'DNS 解析失败',
  ssl_error: 'SSL 错误',
  connection_refused: '服务器拒绝连接',
  connection_reset: '连接被重置',
  connection_closed: '连接被关闭',
  unreachable: '主机不可达',
  blocked_by_waf: 'WAF 拦截',
  redirect_to_home: '跳转到首页',
  redirect_to_error: '跳转到错误页',
  platform_detected: '平台校验',
  unknown: '未知',
}

const VERIFIED_LABEL: Record<string, string> = {
  http: '直连校验',
  browser: '浏览器渲染校验',
  ai: 'AI 复核',
  rule: '规则判定',
}

const SOURCE_LABEL: Record<string, string> = {
  rule_only: '规则判定',
  rule_plus_ai: '规则 + AI',
  adapter: '官方适配器',
  local_agent: '本地代理',
}

type AiVerdict =
  | { state: 'agree'; reasoning: string; confidence: number }
  | { state: 'disagree'; reasoning: string; confidence: number; decision: string }
  | { state: 'skipped'; reason: 'rule_confident' | 'not_eligible' }
  | { state: 'failed'; reason: string }

function short(url: string, max = 60) {
  return url.length > max ? url.slice(0, max) + '...' : url
}

export default function ResultCard({ result }: { result: any }) {
  const [expanded, setExpanded] = useState(false)
  const cls = result.classification
  const evidence = (cls?.evidence ?? {}) as Record<string, any>
  const httpProbe = result.httpProbe
  const browserProbe = result.browserProbe

  const cfg = STATUS_CONFIG[cls?.finalStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.review_required

  const finalUrl: string | null = evidence.finalUrl || browserProbe?.finalUrl || httpProbe?.finalUrl || null
  const showFinalUrl = finalUrl && finalUrl !== result.originalUrl

  const httpStatus: number | null = typeof httpProbe?.statusCode === 'number' ? httpProbe.statusCode : null
  const httpContradicts = httpStatus !== null && httpStatus >= 400 && cls?.finalStatus === 'accessible'

  const aiVerdict = evidence.aiVerdict as AiVerdict | undefined

  const networkSamples = (evidence.networkSamples?.length ? evidence.networkSamples : browserProbe?.networkSamples) ?? []
  const hasNetwork = Array.isArray(networkSamples) && networkSamples.length > 0

  const hasScreenshot = !!(evidence.screenshotPath ?? browserProbe?.screenshotPath)
  const screenshotUrl =
    hasScreenshot && result.taskId
      ? `${getWebVisibleApiRoot()}/tasks/${result.taskId}/urls/${result.id}/screenshot`
      : null

  return (
    <div
      className={`rounded-xl border border-[#2a2d3a] overflow-hidden cursor-pointer transition-colors hover:border-[#3a3d4a] ${expanded ? 'bg-[#1e2235]' : 'bg-[#1a1d27]'}`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="flex-1 text-xs text-[#94a3b8] truncate font-mono" title={result.originalUrl}>
          {short(result.originalUrl)}
        </span>
        <span className={`text-xs font-medium flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
        <span className="text-xs text-[#475569] flex-shrink-0">
          {REASON_LABEL[cls?.reasonCode] ?? cls?.reasonCode ?? '-'}
        </span>
        {cls && (
          <span className="text-xs text-[#475569] flex-shrink-0 w-8 text-right">
            {Math.round(cls.confidence * 100)}%
          </span>
        )}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`flex-shrink-0 text-[#475569] transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-[#2a2d3a] space-y-1.5 text-xs text-[#64748b]">
          <Row label="原始 URL">
            <a
              href={result.originalUrl}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-indigo-400 hover:underline break-all"
            >
              {result.originalUrl}
            </a>
          </Row>

          {showFinalUrl && (
            <Row label="最终 URL">
              <a
                href={finalUrl!}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-indigo-300 hover:underline break-all"
              >
                {finalUrl}
              </a>
            </Row>
          )}

          {evidence.pageTitle && (
            <Row label="页面标题">
              <span className="break-all text-[#94a3b8]">{evidence.pageTitle}</span>
            </Row>
          )}

          {cls?.reasonCode === 'user_screen_hint' &&
            Array.isArray(browserProbe?.domSignals) &&
            browserProbe.domSignals.filter((s: { signal?: string }) => s.signal === 'user_screen_hint').length > 0 && (
              <Row label="命中提示">
                <ul className="list-disc pl-4 space-y-0.5 text-[#94a3b8]">
                  {browserProbe.domSignals
                    .filter((s: { signal?: string }) => s.signal === 'user_screen_hint')
                    .map((s: { value?: string; hintId?: string }, i: number) => (
                      <li key={(s.hintId ?? '') + i} className="break-all">
                        {s.value ?? '(无文案)'}
                      </li>
                    ))}
                </ul>
              </Row>
            )}

          {httpStatus !== null && (
            <Row label="HTTP 状态">
              <span className={httpContradicts ? 'text-amber-300' : ''}>
                {httpStatus}
                {httpContradicts && (
                  <span className="ml-2 text-[10px] text-amber-300/80">
                    （已通过浏览器渲染校验，链接可访问）
                  </span>
                )}
              </span>
            </Row>
          )}

          {httpProbe?.errorCode && httpStatus === null && (
            <Row label="HTTP 错误">
              <span className="text-red-300/90">
                {REASON_LABEL[httpProbe.errorCode] ?? httpProbe.errorCode}
              </span>
            </Row>
          )}

          {evidence.verificationNote && (
            <Row label="校验说明">
              <span className="text-amber-300/90">{evidence.verificationNote}</span>
            </Row>
          )}

          {evidence.verifiedBy && (
            <Row label="校验方式">
              <span>{VERIFIED_LABEL[evidence.verifiedBy] ?? evidence.verifiedBy}</span>
            </Row>
          )}

          {typeof httpProbe?.latencyMs === 'number' && (
            <Row label="响应时间">
              <span>{httpProbe.latencyMs} ms</span>
            </Row>
          )}

          {cls?.sourceOfTruth && (
            <Row label="判定来源">
              <span>{SOURCE_LABEL[cls.sourceOfTruth] ?? cls.sourceOfTruth}</span>
            </Row>
          )}

          {aiVerdict && <AiVerdictRow verdict={aiVerdict} />}

          {cls?.reasonCode === 'network_json_removed' &&
            Array.isArray(browserProbe?.domSignals) &&
            browserProbe.domSignals.filter((s: { signal?: string }) => s.signal === 'network_api_removed').length > 0 && (
              <Row label="XHR 规则命中">
                <ul className="list-disc pl-4 space-y-0.5 text-[#94a3b8]">
                  {browserProbe.domSignals
                    .filter((s: { signal?: string }) => s.signal === 'network_api_removed')
                    .map((s: { value?: string }, i: number) => (
                      <li key={i} className="break-all font-mono text-[11px]">
                        {s.value ?? '-'}
                      </li>
                    ))}
                </ul>
              </Row>
            )}

          {hasNetwork && (
            <Row label="XHR 取证">
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {networkSamples.map((n: Record<string, unknown>, i: number) => (
                  <div key={i} className="rounded border border-[#2a2d3a] bg-[#0f1117]/80 p-2 text-[11px] font-mono">
                    <div className="text-[#94a3b8]">
                      <span className={typeof n.status === 'number' && n.status >= 400 ? 'text-red-300/90' : ''}>
                        {String(n.status ?? '')}
                      </span>{' '}
                      {String(n.method ?? '')} {String(n.resourceType ?? '')}{' '}
                      <span className="text-[#64748b]">{String(n.contentType ?? '')}</span>
                    </div>
                    <div className="break-all text-[#cbd5e1] mt-0.5" title={String(n.url ?? '')}>
                      {short(String(n.url ?? ''), 100)}
                    </div>
                    {typeof n.snippet === 'string' && n.snippet.length > 0 && (
                      <pre className="mt-1 text-[10px] text-[#64748b] whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
                        {n.snippet.length > 800 ? (n.snippet as string).slice(0, 800) + '…' : n.snippet}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </Row>
          )}

          {(evidence.textSnippet || evidence.pageTitle) && (
            <QuickHintFromResult
              platform={result.platform ?? 'generic'}
              pageTitle={evidence.pageTitle}
              textSnippet={evidence.textSnippet}
            />
          )}

          {screenshotUrl && (
            <Row label="截图">
              <div className="space-y-1" onClick={e => e.stopPropagation()}>
                <a
                  href={screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:underline text-[11px]"
                >
                  新标签打开原图
                </a>
                <img
                  src={screenshotUrl}
                  alt="L2 探测视口截图"
                  className="max-w-full rounded-lg border border-[#2a2d3a] max-h-56 object-contain bg-black/40"
                  loading="lazy"
                />
              </div>
            </Row>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-[#475569] w-16 flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function AiVerdictRow({ verdict }: { verdict: AiVerdict }) {
  if (verdict.state === 'agree') {
    return (
      <Row label="AI 复核">
        <span className="text-emerald-300/90">
          ✓ 同意（{Math.round(verdict.confidence * 100)}%）
        </span>
        {verdict.reasoning && (
          <span className="ml-2 text-[#94a3b8]">{verdict.reasoning}</span>
        )}
      </Row>
    )
  }
  if (verdict.state === 'disagree') {
    return (
      <Row label="AI 复核">
        <span className="text-amber-300/90">
          ⚠ 反对，倾向 {verdict.decision}（{Math.round(verdict.confidence * 100)}%）
        </span>
        {verdict.reasoning && (
          <span className="ml-2 text-[#94a3b8]">{verdict.reasoning}</span>
        )}
      </Row>
    )
  }
  if (verdict.state === 'skipped') {
    const why = verdict.reason === 'rule_confident' ? '规则已高置信，无需 AI' : '不在 AI 复核场景'
    return (
      <Row label="AI 复核">
        <span className="text-[#64748b]">未触发（{why}）</span>
      </Row>
    )
  }
  return (
    <Row label="AI 复核">
      <span className="text-red-300/80">未达成（{verdict.reason}）</span>
    </Row>
  )
}
