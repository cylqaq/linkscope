import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'
import axios from 'axios'
import type { AiJudgementInput, AiJudgementOutput, InternalStatus, ReasonCode, RetryStrategy } from '@linkscope/shared'

const PROMPT_VERSION = '1.1.0'

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

const SYSTEM_PROMPT = `你是一个专业的链接内容有效性判断引擎。
你的任务是判断：给定URL的目标内容是否仍然可以被正常访问？

你有一个工具 fetch_url 可以主动获取页面内容。当仅凭HTTP状态码和已知信息无法确定时，主动调用此工具查看页面。

最终输出严格的JSON格式：
{
  "decision": "accessible" | "dead_link" | "review_required",
  "internalStatus": "ok" | "removed" | "soft_404" | "hard_404" | "login_required" | "forbidden" | "rate_limited" | "transient_error" | "risk_blocked" | "unknown",
  "reasonCode": "http_200_ok" | "http_404" | "http_410" | "soft_404_ai" | "removed_pattern" | "video_removed" | "account_private" | "account_banned" | "region_restricted" | "content_deleted" | "auth_403" | "auth_401" | "timeout" | "dns_failed" | "blocked_by_waf" | "redirect_to_home" | "redirect_to_error" | "platform_detected" | "unknown",
  "confidence": 0.0到1.0,
  "reasoning": "简短的判断理由（中文，50字以内）",
  "nextAction": "no_retry" | "retry_with_backoff" | "need_login" | "need_adapter" | "send_to_agent"
}

判断规则：
- "accessible"：页面有实质性内容，用户可以正常查看
- "dead_link"：内容已删除/下架/不存在/账号注销，用户无法看到目标内容
- "review_required"：无法明确判断（如需登录、地区限制），需要人工核查
- confidence应真实反映判断把握度`

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private clients: Map<string, OpenAI> = new Map()

  // Tool implementation: fetch URL and return text content for AI to read
  private async executeFetchUrl(url: string): Promise<string> {
    try {
      const resp = await axios.get(url, {
        timeout: 10000,
        maxRedirects: 5,
        headers: {
          'User-Agent': USER_AGENT,
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
  ): Promise<{ output: AiJudgementOutput; latencyMs: number; tokenUsage: any; modelName: string; toolCallsUsed: number }> {
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

      // Agentic loop: allow AI to call fetch_url up to 2 times
      for (let round = 0; round < 3; round++) {
        const response = await client.chat.completions.create({
          model: modelName,
          messages,
          tools: [FETCH_URL_TOOL],
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
          confidence: 0.3,
          reasoning: 'AI判定失败，转人工复核',
          nextAction: 'no_retry',
        },
        latencyMs: Date.now() - start,
        tokenUsage: null,
        modelName: `${usedProvider}/${modelName}`,
        toolCallsUsed,
      }
    }
  }

  private buildUserMessage(input: AiJudgementInput): string {
    const signals = input.domSignals.map(s => `[${s.type}] ${s.signal}: ${s.value}`).join('\n')
    return `需要判断的URL: ${input.url}
平台: ${input.platform}
HTTP状态码: ${input.httpStatusCode ?? '无（连接失败）'}
最终URL: ${input.finalUrl}
重定向链: ${input.redirectChain.length > 1 ? input.redirectChain.join(' → ') : '无重定向'}
页面标题: ${input.pageTitle ?? '未知（未进行浏览器探测）'}
已抓取页面文本（前500字）:
${input.pageTextSnippet?.slice(0, 500) ?? '无（未进行浏览器探测）'}
DOM信号:
${signals || '无'}

请判断此链接的内容是否仍然可以正常访问。如果需要查看完整页面内容来作出判断，请调用 fetch_url 工具。`
  }

  private sanitizeDecision(d: any): AiJudgementOutput['decision'] {
    if (d === 'accessible' || d === 'dead_link' || d === 'review_required') return d
    return 'review_required'
  }

  get promptVersion() { return PROMPT_VERSION }
}