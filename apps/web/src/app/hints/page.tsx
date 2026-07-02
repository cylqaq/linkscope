'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createScreenHint,
  deleteScreenHint,
  importScreenHints,
  listScreenHints,
  updateScreenHint,
} from '@/lib/api'
import { PLATFORM_CONFIGS } from '@linkscope/shared'

type HintRow = {
  id: string
  platform: string
  phrase: string
  note: string | null
  enabled: boolean
  caseSensitive: boolean
  hitCount: number
  createdAt: string
  updatedAt: string
}

const PLATFORM_OPTIONS = [
  ...PLATFORM_CONFIGS.map(p => ({ id: p.id, name: p.name })),
  { id: 'generic', name: '全平台通用' },
]

export default function ScreenHintsPage() {
  const [rows, setRows] = useState<HintRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [platform, setPlatform] = useState('douyin')
  const [phrase, setPhrase] = useState('')
  const [note, setNote] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setErr(null)
    const data = await listScreenHints()
    setRows(data as HintRow[])
  }, [])

  useEffect(() => {
    load().catch(e => setErr(e?.message ?? '加载失败')).finally(() => setLoading(false))
  }, [load])

  /** 从检测结果「在规则页打开」等场景预填 query */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const p = sp.get('phrase')
    const pl = sp.get('platform')
    const n = sp.get('note')
    if (p) {
      try {
        setPhrase(decodeURIComponent(p))
      } catch {
        setPhrase(p)
      }
    }
    if (pl && PLATFORM_OPTIONS.some(o => o.id === pl)) setPlatform(pl)
    if (n) {
      try {
        setNote(decodeURIComponent(n))
      } catch {
        setNote(n)
      }
    }
  }, [])

  const exportJson = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      hints: rows.map(r => ({
        platform: r.platform,
        phrase: r.phrase,
        note: r.note,
        caseSensitive: r.caseSensitive,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `linkscope-screen-hints-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onImportFile = async (file: File) => {
    setErr(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text) as { items?: unknown[]; hints?: unknown[] }
      const items = Array.isArray(data.items) ? data.items : Array.isArray(data.hints) ? data.hints : null
      if (!items) {
        setErr('JSON 须包含 items 或 hints 数组')
        return
      }
      const r = await importScreenHints(items)
      await load()
      alert(`导入完成：新增 ${r.created} 条，跳过 ${r.skipped} 条`)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '导入失败')
    }
  }

  const onCreate = async () => {
    if (!phrase.trim()) {
      setErr('请填写屏幕上出现的提示文案（子串即可）')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await createScreenHint({
        platform,
        phrase: phrase.trim(),
        note: note.trim() || undefined,
        caseSensitive,
      })
      setPhrase('')
      setNote('')
      setCaseSensitive(false)
      await load()
    } catch (e: any) {
      setErr(e?.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (id: string, enabled: boolean) => {
    setErr(null)
    try {
      await updateScreenHint(id, { enabled: !enabled })
      await load()
    } catch (e: any) {
      setErr(e?.message ?? '更新失败')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('确定删除这条规则？')) return
    setErr(null)
    try {
      await deleteScreenHint(id)
      await load()
    } catch (e: any) {
      setErr(e?.message ?? '删除失败')
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <a href="/" className="text-sm text-[#64748b] hover:text-white transition-colors">← 返回检测</a>
          <h1 className="text-xl font-semibold text-white mt-2">屏幕提示规则</h1>
          <p className="text-sm text-[#64748b] mt-2 max-w-2xl leading-relaxed">
            当某平台链接仍返回 200，但页面上有固定的「已下架 / 不存在」等提示时，把<strong>屏幕上可见的原文</strong>录入为子串。
            下次 L2 浏览器探测到同一平台（或全平台通用）页面正文/标题包含该子串时，将判为失效并记录命中次数。
            可在<strong>检测结果展开卡片</strong>中一键保存；下方支持 JSON 导出/批量导入（与 <code className="text-indigo-300/90">POST /api/screen-hints/import</code> 同结构）。
          </p>
        </div>
        <a href="/history" className="text-sm text-[#64748b] hover:text-white whitespace-nowrap">历史任务</a>
      </div>

      {err && (
        <div className="mb-4 text-sm text-red-300/90 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          disabled={loading || rows.length === 0}
          onClick={exportJson}
          className="text-xs px-3 py-1.5 rounded-lg border border-[#2a2d3a] text-[#94a3b8] hover:bg-[#252836] disabled:opacity-40"
        >
          导出全部规则 JSON
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-lg border border-[#2a2d3a] text-[#94a3b8] hover:bg-[#252836]"
        >
          导入 JSON…
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void onImportFile(f)
            e.target.value = ''
          }}
        />
      </div>

      <section className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-4 mb-8 space-y-3">
        <h2 className="text-sm font-medium text-white">新增规则</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[#64748b] flex flex-col gap-1">
            适用平台
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-sm text-white"
            >
              {PLATFORM_OPTIONS.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#64748b] flex flex-col gap-1 sm:col-span-2">
            提示文案（子串匹配）
            <input
              value={phrase}
              onChange={e => setPhrase(e.target.value)}
              placeholder="从页面复制，例如：该内容已被删除"
              className="bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#475569]"
            />
          </label>
          <label className="text-xs text-[#64748b] flex flex-col gap-1 sm:col-span-2">
            备注（可选）
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="例如：抖音 2025 新版下架页"
              className="bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#475569]"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-[#94a3b8] cursor-pointer">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={e => setCaseSensitive(e.target.checked)}
            className="rounded border-[#2a2d3a]"
          />
          区分大小写（默认不区分）
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onCreate()}
          className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
        >
          {saving ? '保存中…' : '添加规则'}
        </button>
      </section>

      <section>
        <h2 className="text-sm font-medium text-[#94a3b8] mb-3">已有规则</h2>
        {loading && <div className="text-[#64748b] text-sm">加载中…</div>}
        {!loading && rows.length === 0 && (
          <div className="text-[#64748b] text-sm py-8 text-center border border-dashed border-[#2a2d3a] rounded-xl">
            暂无规则。遇到检测漏网的平台时，把页面上的关键提示语加进来即可。
          </div>
        )}
        <div className="space-y-2">
          {rows.map(r => {
            const pname = PLATFORM_OPTIONS.find(p => p.id === r.platform)?.name ?? r.platform
            return (
              <div
                key={r.id}
                className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-indigo-300/90 bg-indigo-950/40 px-2 py-0.5 rounded">{pname}</span>
                    {!r.enabled && (
                      <span className="text-[10px] text-amber-400/90 border border-amber-800/50 rounded px-1.5 py-0">已停用</span>
                    )}
                    {r.caseSensitive && (
                      <span className="text-[10px] text-[#64748b]">Aa 敏感</span>
                    )}
                    <span className="text-[10px] text-[#475569]">命中 {r.hitCount}</span>
                  </div>
                  <div className="text-sm text-white break-all font-mono">{r.phrase}</div>
                  {r.note && <div className="text-xs text-[#64748b]">{r.note}</div>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggle(r.id, r.enabled)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[#2a2d3a] text-[#94a3b8] hover:bg-[#252836]"
                  >
                    {r.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(r.id)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-900/40 text-red-300/90 hover:bg-red-950/20"
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
