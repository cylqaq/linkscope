/**
 * URL normalization and deduplication utilities
 */

const UTM_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'fbclid', 'gclid', 'mc_eid', 'ref', '_ga',
]

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
