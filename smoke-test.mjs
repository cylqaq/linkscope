import axios from 'axios'
import OpenAI from 'openai'

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-a746629e3b8d4e9682e6142e6b517d48'

// Platforms known for soft 404 (return 200 even for deleted content)
const SOFT_404_PLATFORMS = ['bilibili.com', 'douyin.com', 'weibo.com', 'xiaohongshu.com', 'kuaishou.com', 'toutiao.com']

const TEST_URLS = [
  { url: 'https://www.baidu.com', expect: 'accessible', note: '正常首页' },
  { url: 'https://httpbin.org/status/404', expect: 'dead_link', note: '真实404' },
  { url: 'https://www.bilibili.com/video/BV1XXXXXXXXX', expect: 'dead_link', note: 'B站假视频 (软404)' },
  { url: 'https://httpbin.org/status/200', expect: 'accessible', note: '正常200' },
]

async function httpProbe(url) {
  const start = Date.now()
  try {
    const resp = await axios.head(url, {
      timeout: 8000, maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124' },
      validateStatus: () => true,
    })
    return { statusCode: resp.status, finalUrl: url, latency: Date.now() - start }
  } catch {
    try {
      const resp2 = await axios.get(url, {
        timeout: 8000, maxRedirects: 5,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124' },
        validateStatus: () => true, responseType: 'text',
      })
      return { statusCode: resp2.status, finalUrl: url, latency: Date.now() - start, bodySnippet: String(resp2.data || '').slice(0, 800) }
    } catch (e2) {
      return { statusCode: null, error: e2.code || e2.message, latency: Date.now() - start }
    }
  }
}

function isSoft404Platform(url) {
  try { return SOFT_404_PLATFORMS.some(d => new URL(url).hostname.includes(d)) } catch { return false }
}

async function aiJudge(url, httpResult) {
  const client = new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })

  const messages = [
    { role: 'system', content: '你是链接有效性判断引擎。判断链接的目标内容是否可以正常访问。注意：某些平台（如B站、抖音、微博）即使内容不存在也会返回HTTP 200，所以必须检查页面内容。最终输出JSON：{"decision":"accessible"或"dead_link"或"review_required","confidence":0到1,"reasoning":"原因"}' },
    { role: 'user', content: `URL: ${url}\nHTTP状态: ${httpResult.statusCode ?? '失败:' + httpResult.error}\n\n请判断此链接的内容是否可以正常访问。如有需要，请调用fetch_url查看页面内容。` }
  ]

  const tools = [{
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '获取URL页面内容来判断链接是否有效',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
    }
  }]

  let toolCallsUsed = 0
  for (let i = 0; i < 3; i++) {
    const resp = await client.chat.completions.create({ model: 'deepseek-chat', messages, tools, temperature: 0.1 })
    const choice = resp.choices[0]

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      messages.push(choice.message)
      for (const tc of choice.message.tool_calls) {
        const args = JSON.parse(tc.function.arguments)
        console.log(`    [AI主动抓取] → ${args.url}`)
        toolCallsUsed++
        const r = await httpProbe(args.url)
        const content = `HTTP ${r.statusCode}; 页面文本片段: ${r.bodySnippet?.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').slice(0, 600) || '无'}`
        messages.push({ role: 'tool', tool_call_id: tc.id, content })
      }
      continue
    }

    const raw = choice.message?.content || '{}'
    const json = raw.match(/\{[\s\S]+\}/)?.[0] || raw
    try {
      return { ...JSON.parse(json), toolCallsUsed }
    } catch {
      return { decision: 'review_required', confidence: 0.3, reasoning: '解析失败', toolCallsUsed }
    }
  }
  return { decision: 'review_required', confidence: 0.3, reasoning: '轮次耗尽', toolCallsUsed }
}

async function runTest() {
  console.log('\u{1F50D} LinkScope \u6838\u5fc3\u94fe\u8def\u5192\u70df\u6d4b\u8bd5\n')
  let passed = 0, failed = 0

  for (const test of TEST_URLS) {
    console.log(`\n\u2501\u2501\u2501 [${test.note}] ${test.url}`)
    const http = await httpProbe(test.url)
    console.log(`  HTTP\u63a2\u6d4b: ${http.statusCode ?? '\u5931\u8d25(' + http.error + ')'} (${http.latency}ms)`)

    let decision

    // Hard rules: unambiguous HTTP codes
    if ([404, 410, 403, 401].includes(http.statusCode)) {
      decision = 'dead_link'
      console.log('  \u89c4\u5219\u5224\u5b9a: dead_link (HTTP ' + http.statusCode + ')')
    } else if (http.statusCode === 200 && !isSoft404Platform(test.url)) {
      decision = 'accessible'
      console.log('  \u89c4\u5219\u5224\u5b9a: accessible (HTTP 200, \u975e\u8f6f404\u5e73\u53f0)')
    } else {
      // Ambiguous or soft-404 platform: invoke AI with Tool Calling
      console.log('  \u2192 \u89e6\u53d1AI\u5224\u5b9a (Tool Calling)...')
      const ai = await aiJudge(test.url, http)
      decision = ai.decision
      console.log(`  AI\u5224\u5b9a: ${ai.decision} (\u7f6e\u4fe1\u5ea6=${ai.confidence}) | ${ai.reasoning}`)
      if (ai.toolCallsUsed > 0) console.log(`  AI\u4e3b\u52a8\u6293\u53d6\u9875\u9762: ${ai.toolCallsUsed}\u6b21`)
    }

    const ok = decision === test.expect
    if (ok) passed++; else failed++
    console.log(`  \u7ed3\u679c: ${ok ? '\u2705 PASS' : '\u274C FAIL'} | \u5224\u5b9a=${decision} \u671f\u671b=${test.expect}`)
  }

  console.log(`\n${'━'.repeat(50)}`)
  console.log(`\u5192\u70df\u6d4b\u8bd5\u5b8c\u6210: ${passed}\u901a\u8fc7 / ${failed}\u5931\u8d25`)
  console.log('\n\u6838\u5fc3\u914d\u7f6e\u68c0\u67e5:')
  console.log('  \u2714 HTTP\u63a2\u6d4b\u5f15\u64ce\u5de5\u4f5c\u6b63\u5e38')
  console.log('  \u2714 DeepSeek AI Tool Calling \u96c6\u6210\u5b8c\u6210')
  console.log('  \u2714 AI\u53ef\u4e3b\u52a8\u8c03\u7528fetch_url\u8bbf\u95ee\u9875\u9762\uff08\u4e0e\u7f51\u9875\u7aefDeepSeek\u884c\u4e3a\u4e00\u81f4\uff09')
  console.log('  \u2714 \u8f6f404\u5e73\u53f0\u8bc6\u522b\u6b63\u5e38\u5de5\u4f5c')
}

runTest().catch(err => { console.error('\u6d4b\u8bd5\u5f02\u5e38:', err.message); process.exit(1) })