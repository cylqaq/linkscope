# LinkScope · AI 开发指南

> 本文档指导如何在 LinkScope 项目中进行 AI 相关开发，包括模型集成、提示词工程、工具调用等。

## 1. AI 架构概述

LinkScope 的 AI 层采用分层架构：

```
用户请求 → L1/L2 探测 → L3 规则判定 → AI 复核（按需） → 结果融合
```

### 核心组件
- **AiService**：AI 调用入口，支持多模型切换
- **ClassifyService**：规则与 AI 结果融合
- **提示词管理**：版本化系统提示词

## 2. 模型集成

### 2.1 支持的模型提供商

```typescript
// 环境变量配置
AI_PROVIDER=deepseek  // deepseek | openai
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=sk-xxx
```

### 2.2 添加新模型提供商

1. 在 `AiService.getClient()` 中添加配置：
```typescript
const configs: Record<string, { apiKey: string; baseURL: string }> = {
  deepseek: { ... },
  openai: { ... },
  new_provider: {
    apiKey: process.env.NEW_PROVIDER_API_KEY || '',
    baseURL: process.env.NEW_PROVIDER_BASE_URL || 'https://api.example.com',
  },
}
```

2. 在 `getModelName()` 中添加模型映射：
```typescript
const modelMap: Record<string, string> = {
  deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  new_provider: process.env.NEW_PROVIDER_MODEL || 'default-model',
}
```

## 3. 提示词工程

### 3.1 系统提示词版本管理

- 当前版本：`1.3.0`（见 `AiService.PROMPT_VERSION`）
- 版本格式：`主版本.次版本.修订版本`
- 变更记录：在 `DECISIONS.md` 中追加条目

### 3.2 提示词结构

```typescript
const SYSTEM_PROMPT = `你是一个专业的链接内容有效性判断引擎。
你的任务是判断：给定URL的目标内容是否仍然可以被正常访问？

你有两个工具：
1. fetch_url：获取页面HTML内容（快速，但可能被反爬）
2. fetch_url_rendered：使用浏览器渲染页面（慢，但能绕过反爬）

判断规则：
- "accessible"：页面有实质性内容
- "dead_link"：内容已删除/下架/不存在
- "review_required"：无法明确判断

输出严格的JSON格式...`
```

### 3.3 添加新工具

1. 定义工具 Schema：
```typescript
const NEW_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'tool_name',
    description: '工具描述',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: '参数描述' },
      },
      required: ['param1'],
    },
  },
}
```

2. 实现工具执行函数：
```typescript
private async executeToolName(param1: string): Promise<string> {
  // 实现逻辑
  return '结果文本'
}
```

3. 在 `judge()` 方法中添加工具调用处理：
```typescript
if (toolCall.function.name === 'tool_name') {
  const args = JSON.parse(toolCall.function.arguments || '{}')
  const result = await this.executeToolName(args.param1)
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: result,
  })
}
```

## 4. 工具调用最佳实践

### 4.1 工具选择策略

- **fetch_url**：适用于静态页面、API 接口
- **fetch_url_rendered**：适用于 SPA、需要 JS 渲染的页面

### 4.2 工具调用限制

- 最大工具调用轮次：3 轮
- 单次工具调用超时：10 秒
- 工具调用失败处理：返回错误信息，继续下一轮

### 4.3 工具结果处理

```typescript
// 工具结果脱敏
private redactResponseSnippet(raw: string, maxLen: number): string {
  let s = raw.replace(/\r\n/g, '\n')
  // 移除敏感信息
  s = s.replace(/"(access_token|password|secret)"\s*:\s*"[^"]*"/gi, '"$1":"…"')
  return s.slice(0, maxLen)
}
```

## 5. AI 结果融合

### 5.1 融合策略

```typescript
private fuseAiWithRules(rule: RuleVerdict, ai: AiJudgementOutput, why: AiUseDecision['reason']): RuleVerdict {
  // 1. AI 与规则一致：提升置信度
  if (ai.decision === rule.finalStatus) {
    return { ...rule, confidence: Math.min(1, (rule.confidence + ai.confidence) / 2 + 0.05) }
  }
  
  // 2. HTTP 状态冲突：AI 反对则回退到 review_required
  if (why === 'http_status_conflict') {
    return { finalStatus: 'review_required', ... }
  }
  
  // 3. 网络拒连：AI 证明可访问则反转
  if (why === 'connection_failure_double_check' && ai.decision === 'accessible') {
    return { finalStatus: 'accessible', ... }
  }
  
  // 4. 默认：加权融合
  return { ...rule, confidence: rule.confidence * 0.6 + ai.confidence * 0.4 }
}
```

### 5.2 置信度阈值

- 规则置信度 ≥ 0.9：跳过 AI
- AI 置信度 ≥ 0.85：可覆盖规则
- 融合后置信度 < 0.8：标记为 needsReview

## 6. 错误处理

### 6.1 AI 调用失败

```typescript
// 失败时不污染证据（D-004）
if (!result.succeeded) {
  return {
    ...ruleResult,
    evidence: { ...baseEvidence, aiVerdict: { state: 'failed', reason: failureReason } },
    sourceOfTruth: 'rule_only',
  }
}
```

### 6.2 降级策略

- 主模型失败 → 尝试备用模型（`AI_FALLBACK_PROVIDER`）
- 所有模型失败 → 返回 `review_required`

## 7. 性能优化

### 7.1 缓存策略

- 相同 URL 的 AI 结果缓存 1 小时
- 工具调用结果缓存 5 分钟

### 7.2 并发控制

- 单任务 AI 调用并发数：3
- 全局 AI 调用速率限制：100 次/分钟

## 8. 监控与告警

### 8.1 关键指标

- AI 调用成功率
- AI 平均延迟
- 工具调用次数分布
- AI 与规则一致率

### 8.2 告警规则

- AI 调用成功率 < 95%
- AI 平均延迟 > 5 秒
- 工具调用失败率 > 10%

## 9. 测试策略

### 9.1 单元测试

```typescript
describe('AiService', () => {
  it('should return valid judgement', async () => {
    const result = await aiService.judge(mockInput)
    expect(result.output.decision).toBeOneOf(['accessible', 'dead_link', 'review_required'])
    expect(result.output.confidence).toBeGreaterThanOrEqual(0)
    expect(result.output.confidence).toBeLessThanOrEqual(1)
  })
})
```

### 9.2 集成测试

- 测试 AI 与规则融合逻辑
- 测试工具调用链路
- 测试降级策略

## 10. 安全考虑

### 10.1 数据脱敏

- 工具调用结果脱敏处理
- 不将敏感信息传入 AI 模型

### 10.2 访问控制

- AI 调用需要认证
- 工具调用权限控制

### 10.3 审计日志

- 记录所有 AI 调用
- 记录工具调用详情
- 保留判定依据

## 11. 文档规范与边界

### 11.1 文档更新规范

**必须更新文档的场景**：
1. 新增 AI 模型提供商
2. 修改系统提示词
3. 添加新工具
4. 修改融合策略
5. 修改置信度阈值

**更新流程**：
1. 修改代码前先读 `DECISIONS.md` 相关条目
2. 修改后更新本文档对应章节
3. 在 `DECISIONS.md` 追加新条目（D-NNN）
4. 必要时更新 `ARCHITECTURE.md`

### 11.2 边界限制（NEVER）

1. **不修改已发布的提示词版本**：已使用的版本只能废弃，不能修改
2. **不跳过工具调用验证**：所有工具调用必须经过参数验证
3. **不记录敏感信息**：API Key、密码等不得出现在日志或文档中
4. **不绕过错误处理**：所有 AI 调用失败必须返回标准错误格式

### 11.3 测试覆盖率要求

- 单元测试覆盖率：≥ 80%
- 集成测试覆盖率：≥ 70%
- 工具调用测试：100% 覆盖

### 11.4 性能基准（SLA）

- AI 调用平均延迟：≤ 3 秒
- AI 调用成功率：≥ 95%
- 工具调用超时：≤ 10 秒
- 并发处理能力：≥ 100 请求/分钟

### 11.5 版本控制规范

**提示词版本格式**：`主版本.次版本.修订版本`
- 主版本：重大逻辑变更（不向后兼容）
- 次版本：新增功能或工具
- 修订版本：错误修复或小优化

**变更记录位置**：
- 主版本/次版本：`DECISIONS.md` 新增条目
- 修订版本：本文档修订历史章节

### 11.6 错误处理流程

```
AI调用失败
    ↓
记录错误日志（不包含敏感信息）
    ↓
检查备用模型配置
    ↓
有备用模型？
    ├─ 是 → 尝试备用模型
    └─ 否 → 返回标准错误响应
    ↓
备用模型成功？
    ├─ 是 → 返回结果
    └─ 否 → 返回 review_required + 错误原因
```

### 11.7 监控与告警规范

**必须监控的指标**：
1. AI 调用成功率（目标：≥ 95%）
2. AI 调用延迟（目标：P95 ≤ 5秒）
3. 工具调用成功率（目标：≥ 98%）
4. 模型切换次数（异常指标）

**告警阈值**：
- AI 调用成功率 < 90%：立即告警
- AI 调用延迟 P95 > 10秒：警告
- 工具调用失败率 > 5%：警告
- 连续失败 3 次：立即告警

### 11.8 代码审查清单

**修改 AI 相关代码时，必须检查**：
- [ ] 是否更新了提示词版本
- [ ] 是否添加了新的工具调用测试
- [ ] 是否更新了本文档
- [ ] 是否在 `DECISIONS.md` 追加了条目
- [ ] 是否修改了错误处理逻辑
- [ ] 是否添加了新的监控指标
- [ ] 是否考虑了性能影响

### 11.9 向后兼容性保证

**必须保证的兼容性**：
1. 工具调用接口：新增参数必须可选
2. 返回格式：新增字段必须可选
3. 错误码：新增错误码不得影响现有逻辑
4. 提示词：旧版本提示词必须继续工作

**破坏性变更流程**：
1. 在 `DECISIONS.md` 标记为"超越条目"
2. 提供迁移指南
3. 设置废弃期（至少 2 个迭代周期）
4. 更新所有相关文档
