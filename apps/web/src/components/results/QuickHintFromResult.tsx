'use client'

import { useEffect, useRef, useState } from 'react'
import { createScreenHint } from '@/lib/api'

type Props = {
  platform: string
  pageTitle?: string | null
  textSnippet?: string | null
}

export default function QuickHintFromResult({ platform, pageTitle, textSnippet }: Props) {
  const seeded = useRef(false)
  const [phrase, setPhrase] = useState('')
  const [note, setNote] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (seeded.current) return
    const seed = `${textSnippet ?? ''}`.trim() || `${pageTitle ?? ''}`.trim()
    if (seed) {
      seeded.current = true
      setPhrase(seed.slice(0, 400))
    }
  }, [textSnippet, pageTitle])

  const pl = (platform || 'generic').trim() || 'generic'
  const hintsHref = `/hints?platform=${encodeURIComponent(pl)}&phrase=${encodeURIComponent(phrase)}&note=${encodeURIComponent(note)}`

  const onSave = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const t = phrase.trim()
    if (t.length < 2) {
      setErr('提示文案至少 2 个字符')
      return
    }
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await createScreenHint({
        platform: pl,
        phrase: t,
        note: note.trim() || `从检测结果添加 · ${new Date().toISOString().slice(0, 10)}`,
        caseSensitive,
      })
      setMsg('已保存为屏幕提示规则')
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="mt-2 pt-2 border-t border-dashed border-[#2a2d3a] space-y-2"
      onClick={e => e.stopPropagation()}
    >
      <div className="text-[11px] text-[#64748b] font-medium">快速添加屏幕提示（L2 正文子串匹配）</div>
      <textarea
        value={phrase}
        onChange={e => setPhrase(e.target.value)}
        rows={3}
        className="w-full text-[11px] bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-2 py-1.5 text-[#e2e8f0] font-mono"
        placeholder="粘贴页面上可见的下架/失效提示语…"
      />
      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        className="w-full text-[11px] bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-2 py-1 text-[#94a3b8]"
        placeholder="备注（可选；留空则自动生成）"
      />
      <label className="flex items-center gap-2 text-[10px] text-[#94a3b8] cursor-pointer">
        <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
        区分大小写
      </label>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="text-[11px] px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
        >
          {busy ? '保存中…' : '保存规则'}
        </button>
        <a
          href={hintsHref}
          className="text-[11px] text-indigo-400 hover:underline"
          onClick={e => e.stopPropagation()}
        >
          在规则页打开并预填
        </a>
        <span className="text-[10px] text-[#475569]">平台：{pl}</span>
      </div>
      {msg && <div className="text-[11px] text-emerald-400/90">{msg}</div>}
      {err && <div className="text-[11px] text-red-300/90">{err}</div>}
    </div>
  )
}
