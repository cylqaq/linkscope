import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'
import axios from 'axios'
import { DEFAULT_USER_AGENT, type AiJudgementInput, type AiJudgementOutput, type InternalStatus, type ReasonCode, type RetryStrategy } from '@linkscope/shared'
import { BrowserProbeService } from '../probe/browser-probe.service'

const PROMPT_VERSION = '1.3.2'

// Tool definition - lets DeepSeek actively fetch page content just like in its own web UI
const FETCH_URL_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'fetch_url',
    description: '获取指定URL的页面内容。当你需要查看页面实际内容来判断链接是否有效时，调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要获取内容的URL',
        },
      },
      required: ['url'],
    },
  },
}

const FETCH_RENDERED_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'fetch_url_rendered',
    description:
      '用无头浏览器打开 URL、执行前端跳转后提取可见文本与最终地址。用于抖音短链、强 JS 页等：纯 HTTP 常为 404 或空壳，必须用本工具才能看到真实状态。较慢，仅在 fetch_url 明显不可靠时调用。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要渲染探测的 URL' },
      },
      required: ['url'],
    },
  },
}

const SYSTEM_PROMPT = `你是一个专业的链接内容有效性判断引擎。
你的任务是判断：给定 URL 对应的目标内容是否仍然可以被普通用户正常访问？

你拥有两个工具可主动获取证据，必须根据情况选择正确的工具：
1) fetch_url：用纯 HTTP 客户端（axios）请求页面，速度快但易被反爬误导。适合普通文章、API 类目标。
2) fetch_url_rendered：用真实无头浏览器渲染页面，能跑前端跳转、规避大部分反爬。适用场景（强烈建议优先调用）：
   - HTTP 状态与常识矛盾（如抖音/B站短链返回 404 但视频可播）
   - 出现 connection_refused / connection_reset / connection_closed / unreachable / timeout 等"看似断网"错误（必须用浏览器二次验证；浏览器若也连不上，才能确诊死链）
   - 拿到的正文极短或像 JS 壳
   - 用户消息含「XHR/Fetch 取证」时：其中为浏览器内接口响应的 URL、HTTP 状态与 JSON/文本节选（已脱敏）。若节选中出现与「下架/删除/无权限」一致的业务字段或错误码，可与页面文本交叉验证；勿仅凭单条孤立的 4xx 静态资源请求判整页死链。
   - DOM 信号若含 network_api_removed，表示已命中代码维护的「URL 子串 + 响应节选」受控规则（见项目 platform-network-dead-hints）；与取证 JSON 对照后再下结论。

调用建议：
- 上下文显示"AI 触发原因 = http_status_conflict"或"connection_failure_double_check"时，第一次工具调用应直接选 fetch_url_rendered，不要先 fetch_url。
- 重定向到根域 / 登录墙等场景，结合页面文本与平台特征判断。
- 至多两次工具调用即应给出结论。

最终输出严格的 JSON：
{
  "decision": "accessible" | "dead_link" | "review_required",
  "internalStatus": "ok" | "removed" | "soft_404" | "hard_404" | "login_required" | "forbidden" | "rate_limited" | "transient_error" | "risk_blocked" | "unknown",
  "reasonCode": "http_200_ok" | "http_404" | "http_410" | "http_451" | "soft_404_text" | "soft_404_ai" | "user_screen_hint" | "network_json_removed" | "removed_pattern" | "video_removed" | "account_private" | "account_banned" | "region_restricted" | "content_deleted" | "auth_401" | "auth_403" | "timeout" | "dns_failed" | "ssl_error" | "connection_refused" | "connection_reset" | "connection_closed" | "unreachable" | "blocked_by_waf" | "redirect_to_home" | "redirect_to_error" | "platform_detected" | "unknown",
  "confidence": 0.0 到 1.0,
  "reasoning": "中文，50 字以内的判断理由",
  "nextAction": "no_retry" | "retry_with_backoff" | "need_login" | "need_adapter" | "send_to_agent"
}

最终判定标准：
- accessible：页面有实质内容，用户可正常查看。
- dead_link：内容已删除/下架/不存在/账号注销/站点已停服，用户无法访问目标内容。
- review_required：信息不足、需登录、地区限制、运维抖动等，留人工核查。
- confidence 必须真实反映把握度，不要默认 0.9。`

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private clients: Map<string, OpenAI> = new Map()

  constructor(private readonly browserProbe: BrowserProbeService) {}

  // Tool implementation: fetch URL and return text content for AI to read
  private async executeFetchUrl(url: string): Promise<string> {
    try {
      const resp = await axios.get(url, {
        timeout: 10000,
        maxRedirects: 10,
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        validateStatus: () => true,
        responseType: 'text',
      })

      const statusLine = `HTTP ${resp.status} ${resp.statusText}`
      const finalUrl = resp.request?.res?.responseUrl || url

      // Strip HTML tags to get readable text, limit to 3000 chars
      const bodyText = (resp.data as string)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000)

      return `状态码: ${statusLine}\n最终URL: ${finalUrl}\n页面文本:\n${bodyText}`
    } catch (err: any) {
      return `获取页面失败: ${err?.code || err?.message || '未知错误'}`
    }
  }

  private async executeFetchRendered(url: string): Promise<string> {
    try {
      const snap = await this.browserProbe.lightFetchForAi(url)
      if (snap.errorCode) {
        return `渲染探测失败: ${snap.errorCode}\n请求URL: ${url}`
      }
      const sig = snap.domSignals.length ? `DOM 风险信号: ${JSON.stringify(snap.domSignals)}\n` : ''
      const net =
        snap.networkSamples?.length ?
          `XHR/Fetch 取证（${snap.networkSamples.length} 条，URL 已脱敏追踪参数；节选或含业务错误码时可优先采信）：\n${JSON.stringify(snap.networkSamples).slice(0, 12000)}\n`
        : ''
      return [
        `最终URL: ${snap.finalUrl}`,
        `标题: ${snap.pageTitle ?? '(无)'}`,
        sig,
        net,
        `正文摘录:\n${(snap.pageText ?? '').slice(0, 2800)}`,
      ].join('\n')
    } catch (e: any) {
      return `渲染探测异常: ${e?.message || String(e)}`
    }
  }

  private getClient(provider = process.env.AI_PROVIDER || 'deepseek'): OpenAI {
    if (this.clients.has(provider)) return this.clients.get(provider)!

    const configs: Record<string, { apiKey: string; baseURL: string }> = {
      deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseURL: 'https://api.openai.com/v1',
      },
    }

    const cfg = configs[provider] ?? configs.deepseek
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
    this.clients.set(provider, client)
    return client
  }

  private getModelName(provider = process.env.AI_PROVIDER || 'deepseek'): string {
    const modelMap: Record<string, string> = {
      deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    }
    return modelMap[provider] ?? 'deepseek-chat'
  }

  async judge(
    input: AiJudgementInput,
    provider?: string,
  ): Promise<{
    output: AiJudgementOutput
    latencyMs: number
    tokenUsage: any
    modelName: string
    toolCallsUsed: number
    succeeded: boolean
    failureReason?: string
  }> {
    const usedProvider = provider || process.env.AI_PROVIDER || 'deepseek'
    const modelName = this.getModelName(usedProvider)
    const start = Date.now()
    let toolCallsUsed = 0

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: this.buildUserMessage(input) },
    ]

    try {
      const client = this.getClient(usedProvider)

      let renderedRound = 0

      // Agentic loop: allow AI to call fetch tools up to 3 rounds
      for (let round = 0; round < 3; round++) {
        const response = await client.chat.completions.create({
          model: modelName,
          messages,
          tools: [FETCH_URL_TOOL, FETCH_RENDERED_TOOL],
          tool_choice: round === 0 ? 'auto' : 'auto',
          temperature: 0.1,
          max_tokens: 1000,
        })

        const choice = response.choices[0]

        // AI wants to call a tool
        if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
          messages.push(choice.message)

          for (const toolCall of choice.message.tool_calls) {
            if (toolCall.function.name === 'fetch_url') {
              const args = JSON.parse(toolCall.function.arguments || '{}')
              this.logger.debug(`AI fetch_url: ${args.url}`)
              toolCallsUsed++
              const result = await this.executeFetchUrl(args.url)
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
              })
            } else if (toolCall.function.name === 'fetch_url_rendered') {
              const args = JSON.parse(toolCall.function.arguments || '{}')
              this.logger.debug(`AI fetch_url_rendered: ${args.url}`)
              toolCallsUsed++
              let content: string
              if (renderedRound >= 2) {
                content = '本判定流程内渲染抓取次数已达上限，请基于已有信息输出 JSON 结论。'
              } else {
                renderedRound++
                content = await this.executeFetchRendered(args.url)
              }
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content,
              })
            }
          }
          continue // Let AI process the tool result
        }

        // AI is done - parse final output
        const raw = choice.message?.content || '{}'
        // Extract JSON from potential markdown code blocks
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/) || raw.match(/(\{[\s\S]+\})/)
        const jsonStr = jsonMatch ? jsonMatch[1] : raw
        const parsed = JSON.parse(jsonStr)

        const output: AiJudgementOutput = {
          decision: this.sanitizeDecision(parsed.decision),
          internalStatus: (parsed.internalStatus as InternalStatus) || 'unknown',
          reasonCode: (parsed.reasonCode as ReasonCode) || 'unknown',
          confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
          reasoning: parsed.reasoning || '无',
          nextAction: (parsed.nextAction as RetryStrategy) || 'no_retry',
        }

        return {
          output,
          latencyMs: Date.now() - start,
          tokenUsage: response.usage,
          modelName: `${usedProvider}/${modelName}`,
          toolCallsUsed,
          succeeded: true,
        }
      }

      // Fallback if loop exhausted
      throw new Error('AI tool calling loop exhausted')
    } catch (err: any) {
      if (usedProvider !== 'openai' && process.env.AI_FALLBACK_PROVIDER) {
        this.logger.warn(`AI provider ${usedProvider} failed, trying fallback: ${err.message}`)
        return this.judge(input, process.env.AI_FALLBACK_PROVIDER)
      }
      this.logger.error(`AI judgement failed: ${err.message}`)
      return {
        output: {
          decision: 'review_required',
          internalStatus: 'unknown',
          reasonCode: 'unknown',
          confidence: 0,
          reasoning: '',
          nextAction: 'no_retry',
        },
        latencyMs: Date.now() - start,
        tokenUsage: null,
        modelName: `${usedProvider}/${modelName}`,
        toolCallsUsed,
        succeeded: false,
        failureReason: err?.message ?? String(err),
      }
    }
  }

  private buildUserMessage(input: AiJudgementInput): string {
    const signals = input.domSignals.map(s => `[${s.type}] ${s.signal}: ${s.value}`).join('\n')
    const netBlock =
      input.networkSamples?.length ?
        `XHR/Fetch 取证（${input.networkSamples.length} 条）:\n${JSON.stringify(input.networkSamples).slice(0, 14000)}\n`
        : ''
    const triggerHint =
      input.triggerReason === 'http_status_conflict'
        ? '（规则与 HTTP 状态冲突：HTTP 4xx 但被升级为 accessible，需要你用 fetch_url_rendered 确认真实页面）'
        : input.triggerReason === 'connection_failure_double_check'
          ? '（HTTP 层报连接级错误，请优先用 fetch_url_rendered 二次验证；若浏览器也无法访问，则确诊死链）'
          : input.triggerReason === 'ambiguous_status'
            ? '（规则置信度不足或状态模糊，需要你独立判断）'
            : ''

    return `需要判断的 URL: ${input.url}
平台: ${input.platform}
AI 触发原因: ${input.triggerReason ?? 'low_confidence'} ${triggerHint}
HTTP 状态码: ${input.httpStatusCode ?? '无（连接失败）'}
HTTP 错误码: ${input.httpErrorCode ?? '无'}
最终 URL: ${input.finalUrl}
重定向链: ${input.redirectChain.length > 1 ? input.redirectChain.join(' → ') : '无重定向'}
页面标题: ${input.pageTitle ?? '未知（未进行浏览器探测）'}
已抓取页面文本（前 500 字）:
${input.pageTextSnippet?.slice(0, 500) ?? '无（未进行浏览器探测）'}
DOM 信号:
${signals || '无'}
${netBlock ? `---\n${netBlock}` : ''}
请按 system 中的规则与工具调用建议给出 JSON 结论。`
  }

  private sanitizeDecision(d: any): AiJudgementOutput['decision'] {
    if (d === 'accessible' || d === 'dead_link' || d === 'review_required') return d
    return 'review_required'
  }

  get promptVersion() { return PROMPT_VERSION }
}