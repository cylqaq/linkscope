# LinkScope · 架构

## 分层探测流水线

```
URL ─▶ L1 HttpProbe ─▶ L2 BrowserProbe (按需) ─▶ L3 ClassifyService ─▶ Prisma 持久化 ─▶ 前端
                                                       │
                                                       └──▶ AiService (按需复核)
```

每条 URL 的处理在 `apps/api/src/workers/probe.worker.ts` 的 Bull 任务中执行，按 L1 → L2 → L3 顺序产生 `HttpProbe`、`BrowserProbe`、`Classification`（含 `Evidence`）、可选 `AiJudgement` 行。

---

## L1 · HttpProbeService

文件：`apps/api/src/probe/http-probe.service.ts`

- 先 HEAD，遇到 405/501/无响应回退 GET。
- `mapAxiosErrorCode(err)` 将 axios `code` + 错误 `message` 双路识别为统一 `ReasonCode` 字符串：
  - 网络拒连：`connection_refused / connection_reset / connection_closed / unreachable`
  - 其它：`timeout / dns_failed / ssl_error`
  - 拿到 HTTP 响应：`http_<code>`
- 导出常量 `NETWORK_REFUSAL_ERROR_CODES` — L3 与 L2 都会引用，**保持唯一来源**。
- `shouldTriggerBrowserFallback(url, result)` 决定是否启动 L2：
  - HTTP 200/403、社交平台 404/429/503、社交平台多跳后无状态码、所有连接级错误 → `true`
  - `timeout / dns_failed` → `false`（L2 也大概率失败，省成本）

## L2 · BrowserProbeService

文件：`apps/api/src/probe/browser-probe.service.ts`

- Playwright Chromium，headless + stealth init script（去 `webdriver` 标记、补 `chrome.runtime`）。
- 抖音域名等待 `networkidle`（12s 超时），其它站默认 `domcontentloaded` + 3s。
- DOM 文本扫描 `DEAD_TEXT_PATTERNS` 通用「已删除/不存在」中英文模式。
- `mapNavigationError(err)` 将 Chromium `ERR_CONNECTION_*` / `NS_ERROR_*` 翻译为与 L1 相同的 `ReasonCode`，使「两路一致 → 高置信死链」可成立。
- `lightFetchForAi(url)` 跳过截图，给 AI 工具 `fetch_url_rendered` 复用。

## L3 · ClassifyService

文件：`apps/api/src/classify/classify.service.ts`

四阶段，职责严格分离：

```ts
classify():
  ruleResult  = applyRules(url, http, browser, platform)        // 1
  evidence    = buildEvidence(url, http, browser, platform, …)   // 2
  decision    = decideAiUse(ruleResult, http, browser)            // 3
  if decision.use:
    ai        = await runAi(...)
    fused     = fuseAiWithRules(ruleResult, ai.output, decision.reason)
    return { ...fused, evidence: { ...evidence, aiVerdict } }
```

### `applyRules` 优先级（**次序敏感，谨慎调整**）

1. 反爬 `404`：浏览器证明真实可访问 → `accessible / platform_detected / 0.9`
2. `404` 命中登录墙 → `review_required / login_required / 0.82`
3. HTTP 硬死码（404 兜底 / 410 / 451）
4. **网络拒连**：浏览器同样失败 → `dead_link / 0.95`；浏览器证明可访问 → `accessible / 0.85`；不确定 → `dead_link / 0.7`（候选，AI 复核）
5. `dns_failed` → `dead_link / 0.95`
6. `ssl_error` → `review_required / 0.6`
7. `timeout` → `review_required / 0.5`
8. 401/403 → `review_required`（need_login）
9. 5xx / 429 → `review_required`（retry）
10. 平台 dead/login/private patterns
11. 通用 `DOM domSignals` 命中
12. HTTP 重定向到根域 + 浏览器无实质内容 → `dead_link / soft_404`
13. HTTP 200 兜底 → `accessible / 0.75`
14. 未知 → `review_required / 0.4`

### `decideAiUse` 触发表

| reason | 触发场景 | AI 兜底融合 |
|---|---|---|
| `http_status_conflict` | HTTP 4xx 但规则升级为 accessible | AI 反对 → `review_required` |
| `connection_failure_double_check` | 连接级错误或超时 | AI 证可访问 → `accessible` |
| `low_confidence` | 规则 confidence < 0.85 | 高置信 AI 替换 / 加权融合 |
| `ambiguous_status` | `soft_404 / unknown / forbidden / risk_blocked` | 同上 |
| `rule_confident` | 否则（规则 ≥ 0.9 且非上述场景） | 直接 `skipped` |

参见 D-005 / D-007。

## AI 层 · AiService

文件：`apps/api/src/ai/ai.service.ts` · Prompt 版本 `1.3.0`

- 双工具：
  - `fetch_url`（axios）：快、易被反爬。
  - `fetch_url_rendered`（复用 L2 `lightFetchForAi`）：慢但能跑前端跳转、抗反爬。
- `judge()` 返回 `{ output, succeeded, failureReason? }`。**失败不污染 evidence**（D-004）。
- 系统提示明确：当 `triggerReason` 是 `http_status_conflict` 或 `connection_failure_double_check` 时，**第一次工具调用就直接选 `fetch_url_rendered`**。
- 用户消息携带 `triggerReason / httpErrorCode / httpStatusCode / 重定向链 / 已抓取文本 / DOM 信号`，让模型有据可循。

---

## 数据契约（关键类型）

定义在 `packages/shared/src/types.ts`，**前后端共用唯一来源**。

### `HttpProbeResult` / `BrowserProbeResult`
- `errorCode` 字段使用统一 ReasonCode 字符串集（见 L1 描述）。
- `BrowserProbeResult.domSignals` 由 L2 探测填入，L3 用作软 404 命中。

### `Evidence`（前端展示主路径，D-010）
- `finalUrl` = `canonicalizeFinalUrl(浏览器优先 → HTTP → 原 URL)` — 已去追踪参数（D-003）
- `httpFinalUrl / browserFinalUrl` = 原始 URL（仅供排查）
- `verifiedBy` = `'http' | 'browser' | 'ai' | 'rule'`
- `verificationNote` = HTTP 与最终结论冲突或网络拒连场景下的可读说明
- `aiVerdict: AiVerdict` — 必填四态之一

### `AiVerdict`
| state | 含义 | 附带字段 |
|---|---|---|
| `agree` | AI 与规则一致 | `reasoning, confidence` |
| `disagree` | AI 反对（结论被改写为 `review_required`） | `reasoning, confidence, decision` |
| `skipped` | 未触发 | `reason: 'rule_confident' \| 'not_eligible'` |
| `failed` | AI 调用失败 | `reason: string` |

### `ReasonCode`
`packages/shared/src/types.ts` 中的联合类型；**新增 reason 必须同步**：
1. `http-probe.mapAxiosErrorCode` 或 `browser-probe.mapNavigationError`
2. `classify.applyRules` 中的对应分支
3. `apps/web/src/components/results/ResultCard.tsx` 的 `REASON_LABEL`
4. `apps/api/src/export/export.service.ts` 的 `REASON_LABEL`
5. `apps/api/src/ai/ai.service.ts` 系统提示词中的 reasonCode 枚举

---

## 扩展点速查

| 想做什么 | 改哪里 |
|---|---|
| 加平台（如新视频站） | `packages/shared/src/platforms.ts` 增配置 |
| 加追踪参数清理 | `packages/shared/src/url-utils.ts` 中 `PLATFORM_TRACKING_PARAMS` |
| 加新错误码 | 见上一节"5 处同步" |
| 加 AI 工具（如官方 API 适配器） | `ai.service.ts` 工具定义 + 执行函数 + 提示词 |
| 加规则分支 | `classify.applyRules`，**保持次序**（先反爬识别再硬死码） |
| 加新 `verifiedBy` 值 | `types.ts` Evidence + ResultCard `VERIFIED_LABEL` |

---

## 数据库

Prisma + Postgres。Schema 位于 `apps/api/prisma/schema.prisma`：

`Task → TaskUrl → { HttpProbe, BrowserProbe, Classification, AiJudgement }`

`Classification.evidence` 是 `Json` 列承载 `Evidence` 对象 — 改 Evidence 字段无需迁移，但**前端必须容忍历史任务里没有新字段**。

---

## 异步与并发

- Bull 队列名 `probe`，并发 `concurrency: 10`。
- 每个 URL 失败时会 `retry × 3` with exponential backoff（`tasks.service.ts` 中的 `addBulk` 配置）。
- 队列依赖 Redis（`REDIS_HOST/PORT/PASSWORD`）；DB 通过 `DATABASE_URL`。

---

## 前端

- Next.js 14 App Router，`apps/web/src/app/page.tsx` 是聊天式提交入口；`history/page.tsx` 是历史任务列表。
- `ResultCard.tsx` 是单 URL 的展开卡，**唯一被允许直接读 `evidence.*` 的组件**（D-010）。
- 前端不维护自己的 `Evidence` 类型副本，全部从 `@linkscope/shared` 导入。
