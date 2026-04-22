const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

async function request(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function createTask(text?: string, form?: FormData) {
  if (form) {
    const res = await fetch(BASE + '/tasks/upload', { method: 'POST', body: form })
    if (!res.ok) throw new Error('Upload failed')
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
