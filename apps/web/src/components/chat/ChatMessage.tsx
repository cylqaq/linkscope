'use client'

import ResultCard from '@/components/results/ResultCard'
import type { Message } from '@/app/page'

interface Props { message: Message }

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">L</div>
      )}
      <div className={`max-w-[85%] ${isUser ? 'order-first' : ''}`}>
        {isUser ? (
          <div className="bg-[#1e2235] rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-[#e2e8f0] whitespace-pre-wrap break-all">
            {message.content}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Text bubble */}
            <div className="flex items-start gap-2">
              <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-[#e2e8f0]">
                {message.loading ? (
                  <span className="flex items-center gap-2">
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"/>
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"/>
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"/>
                    </span>
                    {message.content}
                  </span>
                ) : message.content}
              </div>
            </div>

            {/* Stats bar */}
            {message.stats && !message.loading && (
              <div className="flex gap-3 flex-wrap">
                <StatBadge label="正常可访问" value={message.stats.accessible} color="green" />
                <StatBadge label="失效链接" value={message.stats.dead} color="red" />
                {message.stats.review > 0 && (
                  <StatBadge label="需复核" value={message.stats.review} color="yellow" />
                )}
                {message.taskId && (
                  <a
                    href={`/api/tasks/${message.taskId}/export?format=csv`}
                    target="_blank"
                    className="flex items-center gap-1.5 text-xs text-[#64748b] hover:text-indigo-400 transition-colors ml-auto"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    导出 CSV
                  </a>
                )}
              </div>
            )}

            {/* Results list */}
            {message.results && !message.loading && message.results.length > 0 && (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {message.results.map((r: any) => (
                  <ResultCard key={r.id} result={r} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[#2a2d3a] flex items-center justify-center text-xs flex-shrink-0 mt-0.5">你</div>
      )}
    </div>
  )
}

function StatBadge({ label, value, color }: { label: string; value: number; color: 'green' | 'red' | 'yellow' }) {
  const colors = {
    green: 'bg-emerald-950/60 text-emerald-400 border-emerald-900',
    red: 'bg-red-950/60 text-red-400 border-red-900',
    yellow: 'bg-amber-950/60 text-amber-400 border-amber-900',
  }
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${colors[color]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${color === 'green' ? 'bg-emerald-400' : color === 'red' ? 'bg-red-400' : 'bg-amber-400'}`}/>
      {label} {value}
    </div>
  )
}
