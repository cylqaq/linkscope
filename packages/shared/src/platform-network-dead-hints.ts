import type { DomSignal, NetworkSample } from './types'

/**
 * 受控的「XHR/Fetch 响应节选」下架信号：须同时满足 URL 子串锚点 + 节选子串，避免仅凭孤立 4xx 判死链（D-015）。
 * 新平台/新接口形态在本文件追加规则并补 DECISIONS 条目；合并前在真实页面上回归。
 */
export type PlatformNetworkDeadHintRule = {
  id: string
  /** `TaskUrl.platform` / detectPlatform id；含 `generic` 时仍须满足 `urlIncludesAll` 的域名锚点 */
  platforms: string[]
  /** response.url 转小写后须全部包含的子串 */
  urlIncludesAll: string[]
  /** 节选正文至少命中其一；无 snippet 的规则不会匹配 */
  snippetIncludesAny: string[]
  /** 若设置，响应 HTTP status 须命中其一 */
  responseStatusIn?: number[]
}

export const PLATFORM_NETWORK_DEAD_HINT_RULES: readonly PlatformNetworkDeadHintRule[] = [
  {
    id: 'dy_aweme_deleted',
    platforms: ['douyin', 'generic'],
    urlIncludesAll: ['douyin', 'aweme'],
    snippetIncludesAny: [
      '该内容已被删除',
      '视频不存在',
      '作品不存在',
      'status_msg":"视频不存在',
      'status_msg":"作品不存在',
      'status_msg":"该内容已被删除',
    ],
  },
  {
    id: 'bili_view_json_deleted',
    platforms: ['bilibili', 'generic'],
    urlIncludesAll: ['bilibili.com', 'view'],
    snippetIncludesAny: ['"code":-404', '"code":-403', '稿件不可见', '视频已失效', '稿件未过审'],
  },
  {
    id: 'xhs_note_api_deleted',
    platforms: ['xiaohongshu', 'generic'],
    urlIncludesAll: ['xiaohongshu.com', 'sns'],
    snippetIncludesAny: ['笔记不存在', '该笔记已删除', 'note not found', '笔记已删除', 'deleted note'],
  },
  {
    id: 'weibo_aj_deleted',
    platforms: ['weibo', 'generic'],
    urlIncludesAll: ['weibo.com', 'aj'],
    snippetIncludesAny: ['微博不存在', '该微博已删除', '此微博已被删除', '此微博不存在', '该微博不存在'],
  },
  {
    id: 'kuaishou_rest_deleted',
    platforms: ['kuaishou', 'generic'],
    urlIncludesAll: ['kuaishou.com', 'rest'],
    snippetIncludesAny: ['该作品已删除', '视频不存在', '作品不存在', '内容不存在', '该视频已删除'],
  },
  {
    id: 'kuaishou_gifshow_rest_deleted',
    platforms: ['kuaishou', 'generic'],
    urlIncludesAll: ['gifshow.com', 'rest'],
    snippetIncludesAny: ['该作品已删除', '视频不存在', '作品不存在', '内容不存在', '该视频已删除'],
  },
]

/** 由 L2 在组装完 networkSamples 后调用，产出可溯源的 domSignals */
export function matchNetworkDeadDomSignals(platformKey: string, samples: NetworkSample[]): DomSignal[] {
  const pk = (platformKey || 'generic').toLowerCase()
  const out: DomSignal[] = []
  const matchedRuleIds = new Set<string>()

  for (const sample of samples) {
    const snippet = sample.snippet
    if (!snippet || snippet.length < 4) continue
    const url = sample.url.toLowerCase()

    for (const rule of PLATFORM_NETWORK_DEAD_HINT_RULES) {
      if (matchedRuleIds.has(rule.id)) continue
      const platformOk = rule.platforms.includes('generic') || rule.platforms.some(p => p.toLowerCase() === pk)
      if (!platformOk) continue
      if (rule.responseStatusIn && !rule.responseStatusIn.includes(sample.status)) continue
      if (!rule.urlIncludesAll.every(s => url.includes(s.toLowerCase()))) continue
      if (!rule.snippetIncludesAny.some(s => snippet.includes(s))) continue

      matchedRuleIds.add(rule.id)
      const urlExcerpt = sample.url.length > 180 ? `${sample.url.slice(0, 180)}…` : sample.url
      out.push({
        type: 'page_structure',
        signal: 'network_api_removed',
        value: `${rule.id}:${urlExcerpt}`,
      })
    }
  }

  return out
}
