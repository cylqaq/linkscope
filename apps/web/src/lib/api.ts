/**
 * 供 `<img src>` / `<a href>`：未设置 `NEXT_PUBLIC_API_URL` 时用同源 `/api`（经 Next rewrite），
 * SSR 与 LAN IP 访问下均与 `fetch` 默认行为一致，避免 hydration 与 CORS。
 */
export function getWebVisibleApiRoot(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  return '/api'
}

/**
 * API 根（含 `/api` 前缀、无尾部 `/`）。
 * - 未设置 `NEXT_PUBLIC_API_URL`：浏览器用 `当前 origin + /api`，经 `next.config.js` rewrites 转发到 Nest，避免 LAN IP 访问前端时的 CORS。
 * - 前后端分离部署：设置 `NEXT_PUBLIC_API_URL=https://你的-api主机/api`。
 */
export function getPublicApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api`.replace(/\/$/, '')
  }
  const internal = process.env.API_URL?.trim() || 'http://127.0.0.1:3001/api'
  return internal.replace(/\/$/, '')
}

function humanizeNetworkError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (err instanceof TypeError && /fetch/i.test(raw)) {
    return '无法连接后端：请确认已启动 API（如 `pnpm --filter @linkscope/api dev`），且 Next 的 `API_URL` 能访问到该服务。'
  }
  if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED/i.test(raw)) {
    return '无法连接后端：请确认 API 在运行，并检查 `API_URL` / `NEXT_PUBLIC_API_URL` 是否与部署方式一致。'
  }
  return raw
}

async function request(path: string, init?: RequestInit) {
  const base = getPublicApiBase()
  let res: Response
  try {
    res = await fetch(base + path, {
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      ...init,
    })
  } catch (e) {
    throw new Error(humanizeNetworkError(e))
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function createTask(text?: string, form?: FormData) {
  if (form) {
    const base = getPublicApiBase()
    let res: Response
    try {
      res = await fetch(base + '/tasks/upload', { method: 'POST', body: form })
    } catch (e) {
      throw new Error(humanizeNetworkError(e))
    }
    if (!res.ok) throw new Error('上传失败：' + (await res.text().catch(() => res.status)))
    return res.json()
  }
  return request('/tasks', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function pollTask(taskId: string) {
  return request('/tasks/' + taskId)
}

export async function getResults(taskId: string, opts?: { pageSize?: number; finalStatus?: string }) {
  const params = new URLSearchParams()
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  if (opts?.finalStatus) params.set('finalStatus', opts.finalStatus)
  return request('/tasks/' + taskId + '/results?' + params.toString())
}

export async function listTasks(page = 1) {
  return request('/tasks?page=' + page)
}

export async function listScreenHints(platform?: string) {
  const q = platform ? `?platform=${encodeURIComponent(platform)}` : ''
  return request('/screen-hints' + q)
}

export async function createScreenHint(body: {
  platform: string
  phrase: string
  note?: string
  caseSensitive?: boolean
}) {
  return request('/screen-hints', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateScreenHint(
  id: string,
  patch: Partial<{ phrase: string; note: string | null; enabled: boolean; caseSensitive: boolean; platform: string }>,
) {
  return request('/screen-hints/' + id, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteScreenHint(id: string) {
  return request('/screen-hints/' + id, { method: 'DELETE' })
}

/** 批量导入；每项字段同 createScreenHint；支持服务端识别 `{ hints: [...] }` 导出格式 */
export async function importScreenHints(items: unknown[]) {
  return request('/screen-hints/import', {
    method: 'POST',
    body: JSON.stringify({ items }),
  }) as Promise<{ created: number; skipped: number }>
}
