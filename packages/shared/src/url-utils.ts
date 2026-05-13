/**
 * URL normalization and deduplication utilities
 */

const UTM_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'fbclid', 'gclid', 'mc_eid', 'ref', '_ga',
]

// 平台短链跳转后常附带的「来源/会话」追踪参数；与去重/展示都该被剥掉
const PLATFORM_TRACKING_PARAMS = [
  'previous_page', 'enter_from', 'enter_method', 'share_token', 'share_app_id',
  'share_link_id', 'share_sign', 'share_app_name', 'tt_from', 'u_code',
  'timestamp', 'sec_uid', 'iid', 'with_sec_did',
  'spm', 'spm_id_from', 'vd_source',
  'xsec_token', 'xsec_source', 'apptype',
]

const ALL_STRIP_PARAMS = new Set<string>([...UTM_PARAMS, ...PLATFORM_TRACKING_PARAMS])

/** 在保留语义的前提下，剥离已知的追踪/会话参数 */
export function stripTrackingParams(input: string): string {
  try {
    const u = new URL(input)
    const keep: [string, string][] = []
    u.searchParams.forEach((v, k) => {
      if (!ALL_STRIP_PARAMS.has(k.toLowerCase())) keep.push([k, v])
    })
    u.search = ''
    for (const [k, v] of keep) u.searchParams.append(k, v)
    return u.toString()
  } catch {
    return input
  }
}

export function normalizeUrl(raw: string): string | null {
  try {
    let url = raw.trim()
    // Add protocol if missing
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url
    }
    const parsed = new URL(url)
    // Remove UTM and tracking params
    for (const param of UTM_PARAMS) {
      parsed.searchParams.delete(param)
    }
    // Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase()
    // Remove trailing slash from path if it's the root
    if (parsed.pathname === '/') {
      parsed.pathname = '/'
    }
    return parsed.toString()
  } catch {
    return null
  }
}

export function dedupeKey(url: string): string {
  // Canonical dedup key – strip protocol, trailing slash, www
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

export function extractUrlsFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s,;"\u200b\u3001]+/gi
  const matches = text.match(urlRegex) ?? []
  return [...new Set(matches.map(u => u.replace(/[.,)>]+$/, '')))]
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * 平台规范化：把「视频详情/笔记详情」类 URL 折叠到稳定 canonical 形态。
 * 用途：展示给用户、判定 finalUrl 是否合理（短链已经解析到内容页）。
 */
export function canonicalizeFinalUrl(input: string): string {
  const stripped = stripTrackingParams(input)
  try {
    const u = new URL(stripped)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()

    // 抖音视频/笔记详情
    if (host === 'douyin.com' || host.endsWith('.douyin.com')) {
      const m = u.pathname.match(/^\/(video|note)\/(\d+)/)
      if (m) return `https://www.douyin.com/${m[1]}/${m[2]}`
    }

    // B 站视频
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
      const m = u.pathname.match(/^\/video\/(BV[\w]+|av\d+)/i)
      if (m) return `https://www.bilibili.com/video/${m[1]}/`
    }

    // 小红书笔记
    if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')) {
      const m = u.pathname.match(/^\/explore\/([0-9a-f]+)/i)
      if (m) return `https://www.xiaohongshu.com/explore/${m[1]}`
    }

    return stripped
  } catch {
    return stripped
  }
}
