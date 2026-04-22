'use client'

import { useState, useRef, KeyboardEvent } from 'react'

interface Props {
  onSubmit: (text: string, file?: File) => void
  disabled?: boolean
}

export default function ChatInput({ onSubmit, disabled }: Props) {
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setText('')
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleFile = (file: File) => {
    const allowed = ['.txt', '.csv', '.xlsx', '.json']
    const ok = allowed.some(ext => file.name.toLowerCase().endsWith(ext))
    if (!ok) return alert('请上传 txt / csv / xlsx / json 格式的文件')
    onSubmit('', file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div
      className={`relative rounded-2xl border transition-colors ${dragging ? 'border-indigo-500 bg-indigo-950/20' : 'border-[#2a2d3a] bg-[#1a1d27]'}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled}
        rows={3}
        placeholder="粘贴链接（每行一个），或拖拽上传文件... 按 Enter 发送，Shift+Enter 换行"
        className="w-full bg-transparent resize-none px-4 pt-4 pb-12 text-sm text-[#e2e8f0] placeholder-[#475569] outline-none"
      />
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title="上传文件"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#64748b] hover:text-white hover:bg-[#2a2d3a] transition-colors disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </button>
        <button
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.csv,.xlsx,.json"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}
