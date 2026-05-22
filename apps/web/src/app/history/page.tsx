'use client'

import { useEffect, useState } from 'react'
import { listTasks } from '@/lib/api'

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中', running: '检测中', partial_done: '部分完成', completed: '已完成', failed: '失败',
}

export default function HistoryPage() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listTasks().then(d => setTasks(d.items || [])).finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <a href="/" className="text-sm text-[#64748b] hover:text-white transition-colors">← 返回</a>
          <h1 className="text-xl font-semibold text-white mt-2">历史任务</h1>
        </div>
        <a href="/hints" className="text-sm text-[#64748b] hover:text-white transition-colors">屏幕提示规则</a>
      </div>

      {loading && <div className="text-[#64748b] text-sm">加载中...</div>}

      {!loading && tasks.length === 0 && (
        <div className="text-[#64748b] text-sm text-center py-16">还没有检测任务</div>
      )}

      <div className="space-y-3">
        {tasks.map(task => (
          <div key={task.id} className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-white font-medium">{task.name || task.id}</div>
                <div className="text-xs text-[#64748b] mt-0.5">
                  {new Date(task.createdAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <span className="text-xs text-[#64748b] flex-shrink-0">{STATUS_LABEL[task.status] ?? task.status}</span>
            </div>
            <div className="flex gap-4 mt-3 text-xs">
              <span className="text-emerald-400">可访问 {task.accessibleCount}</span>
              <span className="text-red-400">失效 {task.deadLinkCount}</span>
              {task.reviewCount > 0 && <span className="text-amber-400">复核 {task.reviewCount}</span>}
              <span className="text-[#64748b]">共 {task.totalUrls}</span>
              {task.status === 'completed' && (
                <a
                  href={`/api/tasks/${task.id}/export?format=csv`}
                  className="ml-auto text-indigo-400 hover:underline"
                  target="_blank"
                >
                  导出 CSV
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
