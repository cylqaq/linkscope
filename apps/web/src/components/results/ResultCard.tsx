'use client'

import { useState } from 'react'

const STATUS_CONFIG = {
  accessible: { label: '正常', color: 'text-emerald-400', dot: 'bg-emerald-400', bg: 'bg-emerald-950/40' },
  dead_link: { label: '失效', color: 'text-red-400', dot: 'bg-red-400', bg: 'bg-red-950/40' },
  review_required: { label: '复核', color: 'text-amber-400', dot: 'bg-amber-400', bg: 'bg-amber-950/40' },
}

const REASON_LABEL: Record<string, string> = {
  http_200_ok: '正常',
  http_404: '404 页面不存在',
  http_410: '410 已永久删除',
  http_451: '451 法律限制',
  auth_401: '需要登录',
  auth_403: '无权限',
  soft_404_text: '软404(文本)',
  soft_404_ai: '软404(AI)',
  removed_pattern: '平台下架',
  video_removed: '视频已删除',
  account_private: '账号私密',
  account_banned: '账号封禁',
  region_restricted: '地区限制',
  content_deleted: '内容删除',
  timeout: '连接超时',
  dns_failed: 'DNS失败',
  ssl_error: 'SSL错误',
  blocked_by_waf: 'WAF拦截',
  redirect_to_home: '跳首页',
  unknown: '未知',
}

export default function ResultCard({ result }: { result: any }) {
  const [expanded, setExpanded] = useState(false)
  const cls = result.classification
  const cfg = STATUS_CONFIG[cls?.finalStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.review_required

  const short = (url: string, max = 60) => url.length > max ? url.slice(0, max) + '...' : url

  return (
    <div
      className={`rounded-xl border border-[#2a2d3a] overflow-hidden cursor-pointer transition-colors hover:border-[#3a3d4a] ${expanded ? 'bg-[#1e2235]' : 'bg-[#1a1d27]'}`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />

        {/* URL */}
        <span className="flex-1 text-xs text-[#94a3b8] truncate font-mono" title={result.originalUrl}>
          {short(result.originalUrl)}
        </span>

        {/* Status badge */}
        <span className={`text-xs font-medium flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>

        {/* Reason */}
        <span className="text-xs text-[#475569] flex-shrink-0">
          {REASON_LABEL[cls?.reasonCode] ?? cls?.reasonCode ?? '-'}
        </span>

        {/* Confidence */}
        {cls && (
          <span className="text-xs text-[#475569] flex-shrink-0 w-8 text-right">
            {Math.round(cls.confidence * 100)}%
          </span>
        )}

        {/* Expand arrow */}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`flex-shrink-0 text-[#475569] transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-[#2a2d3a] space-y-1.5 text-xs text-[#64748b]">
          <div className="flex gap-2">
            <span className="text-[#475569] w-16 flex-shrink-0">原始 URL</span>
            <a href={result.originalUrl} target="_blank" className="text-indigo-400 hover:underline break-all">{result.originalUrl}</a>
          </div>
          {result.httpProbe?.finalUrl && result.httpProbe.finalUrl !== result.originalUrl && (
            <div className="flex gap-2">
              <span className="text-[#475569] w-16 flex-shrink-0">最终 URL</span>
              <span className="break-all">{result.httpProbe.finalUrl}</span>
            </div>
          )}
          {result.httpProbe?.statusCode && (
            <div className="flex gap-2">
              <span className="text-[#475569] w-16 flex-shrink-0">HTTP 状态</span>
              <span>{result.httpProbe.statusCode}</span>
            </div>
          )}
          {result.httpProbe?.latencyMs && (
            <div className="flex gap-2">
              <span className="text-[#475569] w-16 flex-shrink-0">响应时间</span>
              <span>{result.httpProbe.latencyMs} ms</span>
            </div>
          )}
          {cls?.sourceOfTruth && (
            <div className="flex gap-2">
              <span className="text-[#475569] w-16 flex-shrink-0">判定来源</span>
              <span>{cls.sourceOfTruth}</span>
            </div>
          )}
          {result.aiJudgement?.reasoning && (
            <div className="flex gap-2">
              <span className="text-[#475569] w-16 flex-shrink-0">AI 理由</span>
              <span className="text-[#94a3b8]">{result.aiJudgement.reasoning}</span>
            </div>
          )}
          {result.browserProbe?.screenshotPath && (
            <div className="flex gap-2">
              <span className="text-[#475569] w-16 flex-shrink-0">截图</span>
              <span className="text-[#475569]">已采集</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
