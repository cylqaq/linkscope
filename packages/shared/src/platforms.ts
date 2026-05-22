import type { PlatformId } from './types'

export interface PlatformConfig {
  id: PlatformId
  name: string
  domains: string[]
  // Patterns in page text/title indicating content is removed/unavailable
  deadPatterns: RegExp[]
  // Patterns indicating login required
  loginPatterns: RegExp[]
  // Patterns indicating private/banned account
  privatePatterns: RegExp[]
  // Patterns indicating region block
  regionPatterns: RegExp[]
}

export const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    id: 'douyin',
    name: '抖音',
    domains: ['douyin.com', 'iesdouyin.com', 'v.douyin.com'],
    deadPatterns: [
      /该内容已被删除/i,
      /视频已删除/i,
      /内容不存在/i,
      /作品不存在/i,
      /该视频已被作者删除/i,
    ],
    loginPatterns: [/请登录后查看/i, /登录后可见/i],
    privatePatterns: [/该账号已注销/i, /该账号被封禁/i, /私密账户/i],
    regionPatterns: [/当前地区不支持/i, /此内容在您所在的地区不可用/i],
  },
  {
    id: 'toutiao',
    name: '今日头条',
    domains: ['toutiao.com', 'mp.toutiao.com'],
    deadPatterns: [
      /文章不存在/i,
      /内容已删除/i,
      /该文章已被删除/i,
      /此文已被屏蔽/i,
    ],
    loginPatterns: [/请登录后查看/i],
    privatePatterns: [/账号已注销/i, /账号被封禁/i],
    regionPatterns: [],
  },
  {
    id: 'kuaishou',
    name: '快手',
    domains: ['kuaishou.com', 'gifshow.com', 'v.kuaishou.com'],
    deadPatterns: [
      /该内容已被删除/i,
      /视频已删除/i,
      /内容不可用/i,
      /该作品已被删除/i,
    ],
    loginPatterns: [/请登录查看/i, /登录后可见/i],
    privatePatterns: [/该账号已被注销/i, /账号被封禁/i],
    regionPatterns: [],
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    domains: ['xiaohongshu.com', 'xhslink.com'],
    deadPatterns: [
      /笔记不存在/i,
      /内容已删除/i,
      /该笔记已被删除/i,
      /内容不可见/i,
    ],
    loginPatterns: [/请登录后查看/i, /登录查看全文/i],
    privatePatterns: [/私密笔记/i, /仅自己可见/i],
    regionPatterns: [],
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    domains: ['bilibili.com', 'b23.tv'],
    deadPatterns: [
      /视频不见了/i,
      /\-404/i,
      /啊哦，您访问的页面不见了/i,
      /视频去哪了/i,
      /该视频已被删除/i,
      /稿件不可见/i,
    ],
    loginPatterns: [/请登录后观看/i, /大会员专享/i],
    privatePatterns: [/账号已注销/i, /用户不存在/i],
    regionPatterns: [/由于版权原因/i, /地区限制/i],
  },
  {
    id: 'weibo',
    name: '微博',
    domains: ['weibo.com', 'weibo.cn', 't.cn'],
    deadPatterns: [
      /微博不存在/i,
      /该微博已删除/i,
      /内容已被删除/i,
      /该博文已被屏蔽/i,
    ],
    loginPatterns: [/请先登录/i, /登录查看/i],
    privatePatterns: [/该用户已注销/i, /该账号被封禁/i, /私密微博/i],
    regionPatterns: [],
  },
  {
    id: 'huoshan',
    name: '火山',
    domains: ['huoshanzhibo.com', 'huoshan.com'],
    deadPatterns: [/内容已删除/i, /视频不存在/i],
    loginPatterns: [/请登录/i],
    privatePatterns: [/账号不存在/i],
    regionPatterns: [],
  },
  {
    id: 'baijiahao',
    name: '百家号',
    domains: ['baijiahao.baidu.com'],
    deadPatterns: [/文章不存在/i, /内容已删除/i, /该文章已下线/i],
    loginPatterns: [],
    privatePatterns: [/账号已注销/i],
    regionPatterns: [],
  },
  {
    id: 'xigua',
    name: '西瓜视频',
    domains: ['ixigua.com'],
    deadPatterns: [/视频不存在/i, /该视频已被删除/i, /内容不可用/i],
    loginPatterns: [/请登录后观看/i],
    privatePatterns: [/账号已注销/i],
    regionPatterns: [],
  },
  {
    id: 'duxiaoshi',
    name: '度小视',
    domains: ['miaopai.com', 'duxiaoshi.com'],
    deadPatterns: [/视频不存在/i, /内容已删除/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'dongchedi',
    name: '懂车帝',
    domains: ['dongchedi.com'],
    deadPatterns: [/内容不存在/i, /文章已删除/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'haokan',
    name: '好看视频',
    domains: ['haokan.baidu.com'],
    deadPatterns: [/视频不存在/i, /内容已删除/i, /该视频已下线/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'dayu',
    name: '大鱼号',
    domains: ['uc.cn', 'mp.uc.cn', 'dayu.com'],
    deadPatterns: [/文章不存在/i, /内容已删除/i],
    loginPatterns: [],
    privatePatterns: [/账号已注销/i],
    regionPatterns: [],
  },
  {
    id: 'weixin_channels',
    name: '微信视频号',
    domains: ['channels.weixin.qq.com', 'finder.video.qq.com'],
    deadPatterns: [/该内容不存在/i, /视频已删除/i, /该直播已结束/i],
    loginPatterns: [/请在微信中打开/i, /请登录微信/i],
    privatePatterns: [/该用户不存在/i],
    regionPatterns: [],
  },
  {
    id: 'pipixia',
    name: '皮皮虾',
    domains: ['pipix.com', 'h5.pipix.com'],
    deadPatterns: [/内容不存在/i, /该内容已被删除/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'wangyi_video',
    name: '网易视频',
    domains: ['v.163.com', 'open.163.com'],
    deadPatterns: [/视频不存在/i, /该视频已下线/i, /内容已删除/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'weishi',
    name: '腾讯微视',
    domains: ['weishi.qq.com'],
    deadPatterns: [/内容不存在/i, /视频已删除/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'tencent_news',
    name: '腾讯新闻',
    domains: ['news.qq.com', 'new.qq.com', 'xw.qq.com'],
    deadPatterns: [/文章不存在/i, /内容已删除/i, /该内容已下架/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'souhu_video',
    name: '搜狐视频',
    domains: ['tv.sohu.com', 'my.tv.sohu.com'],
    deadPatterns: [/视频不存在/i, /该视频已删除/i, /内容已下线/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
  {
    id: 'yangshipin',
    name: '央视频',
    domains: ['yangshipin.cn'],
    deadPatterns: [/视频不存在/i, /内容已删除/i, /该视频暂不可用/i],
    loginPatterns: [],
    privatePatterns: [],
    regionPatterns: [],
  },
]

const domainToConfig = new Map<string, PlatformConfig>()
for (const config of PLATFORM_CONFIGS) {
  for (const domain of config.domains) {
    domainToConfig.set(domain, config)
  }
}

export function detectPlatform(url: string): PlatformConfig | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    // Exact match
    if (domainToConfig.has(hostname)) return domainToConfig.get(hostname)!
    // Suffix match (e.g., mp.toutiao.com)
    for (const [domain, config] of domainToConfig) {
      if (hostname.endsWith('.' + domain) || hostname === domain) {
        return config
      }
    }
    return null
  } catch {
    return null
  }
}

/** 屏幕文案规则可选 `platform` 字段：各已知平台 + 全平台通用 */
export const SCREEN_HINT_PLATFORM_SLUGS: readonly string[] = [...PLATFORM_CONFIGS.map(c => c.id), 'generic']

export function isScreenHintPlatformSlug(s: string): boolean {
  return SCREEN_HINT_PLATFORM_SLUGS.includes(s)
}
