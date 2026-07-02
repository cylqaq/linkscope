'use client'

import { useState, useRef, useEffect } from 'react'
import ChatInput from '@/components/chat/ChatInput'
import ChatMessage from '@/components/chat/ChatMessage'
import ResultCard from '@/components/results/ResultCard'
import { createTask, pollTask, getResults } from '@/lib/api'

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  taskId?: string
  results?: any[]
  stats?: { accessible: number; dead: number; review: number; total: number }
  loading?: boolean
}

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '你好！把需要检测的链接发给我，支持直接粘贴（一行一个）或上传文件（txt / csv / xlsx / json）。我会自动检测每个链接是否仍然有效。',
    },
  ])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (text: string, file?: File) => {
    if (loading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: file ? `上传文件：${file.name}` : text }
    const thinkingId = Date.now().toString() + '-thinking'
    const thinkingMsg: Message = { id: thinkingId, role: 'assistant', content: '正在解析链接并开始检测...', loading: true }

    setMessages(prev => [...prev, userMsg, thinkingMsg])
    setLoading(true)

    try {
      let task: any
      if (file) {
        const form = new FormData()
        form.append('file', file)
        task = await createTask(undefined, form)
      } else {
        task = await createTask(text)
      }

      // Update thinking message with task info
      setMessages(prev => prev.map(m =>
        m.id === thinkingId
          ? { ...m, content: `已识别 ${task.totalUrls} 个链接，正在检测中...`, taskId: task.id, loading: true }
          : m
      ))

      // Poll for completion
      let done = false
      let lastCompleted = 0
      while (!done) {
        await new Promise(r => setTimeout(r, 2000))
        const updated = await pollTask(task.id)
        
        if (updated.completedUrls > lastCompleted) {
          lastCompleted = updated.completedUrls
          setMessages(prev => prev.map(m =>
            m.id === thinkingId
              ? { ...m, content: `检测进度：${updated.completedUrls} / ${updated.totalUrls}`, loading: true }
              : m
          ))
        }

        if (updated.status === 'completed' || updated.status === 'failed') {
          done = true
          const resultsData = await getResults(task.id, { pageSize: 200 })
          
          setMessages(prev => prev.map(m =>
            m.id === thinkingId
              ? {
                  ...m,
                  loading: false,
                  content: `检测完成！共 ${updated.totalUrls} 个链接`,
                  stats: {
                    accessible: updated.accessibleCount,
                    dead: updated.deadLinkCount,
                    review: updated.reviewCount,
                    total: updated.totalUrls,
                  },
                  results: resultsData.items,
                  taskId: task.id,
                }
              : m
          ))
        }
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === thinkingId
          ? { ...m, loading: false, content: '检测失败，请检查输入并重试。错误：' + (err?.message ?? '未知') }
          : m
      ))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">L</div>
          <span className="font-semibold text-white">LinkScope</span>
          <span className="text-xs text-[#64748b] bg-[#1a1d27] px-2 py-0.5 rounded-full">链接有效性检测</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/history" className="text-sm text-[#64748b] hover:text-white transition-colors">历史任务</a>
          <a href="/hints" className="text-sm text-[#64748b] hover:text-white transition-colors">屏幕提示</a>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-6">
        <ChatInput onSubmit={handleSubmit} disabled={loading} />
      </div>
    </div>
  )
}
