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
- DOM 文本扫描 `DEAD_TEXT_PATTERNS` 通用「已删除/不存在」中英文模式；命中写入 `domSignals.signal = dead_content_text`。
- **用户屏幕提示库**：`ScreenHintsService` 提供启用的 `screen_hints` 行；按 `TaskUrl.platform` 与 `platform = generic` 过滤；对页面正文+标题做子串匹配（可选区分大小写），命中写入 `domSignals.signal = user_screen_hint` 并带 `hintId`。管理 UI：`/hints`（含 JSON 导出/导入、`POST /api/screen-hints/import`）；结果卡 `QuickHintFromResult` 一键写入；REST：`/api/screen-hints`。
- **XHR/Fetch 取证**：监听页面 `xhr`/`fetch` 响应，写入 `networkSamples`（URL 去已知追踪参数；少量 JSON/文本 body 脱敏节选）；同步进 `Evidence` 与 AI 用户消息；**不单独**作为死链充分条件（避免静态资源 404 误判）。Prompt `1.3.2`。
- **受控 XHR 下架子串**：`matchNetworkDeadDomSignals`（`packages/shared/src/platform-network-dead-hints.ts`）对 `networkSamples` 的 `url + snippet` 做白名单匹配，命中写入 `domSignals.signal = network_api_removed`；L3 输出 `network_json_removed`（D-015）。
- `mapNavigationError(err)` 将 Chromium `ERR_CONNECTION_*` / `NS_ERROR_*` 翻译为与 L1 相同的 `ReasonCode`，使「两路一致 → 高置信死链」可成立。
- `lightFetchForAi(url)` 跳过截图，给 AI 工具 `fetch_url_rendered` 复用（平台键由 URL `detectPlatform` 推导）。

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
11. **用户屏幕提示**：`domSignals` 含 `user_screen_hint` → `dead_link` / `user_screen_hint` / 0.94
12. **XHR 受控下架规则**：`domSignals` 含 `network_api_removed`（规则表 `packages/shared/src/platform-network-dead-hints.ts`）→ `dead_link` / `network_json_removed` / 0.91
13. 通用内置 `dead_content_text`（`DEAD_TEXT_PATTERNS`）命中 → `soft_404_text`
14. HTTP 重定向到根域 + 浏览器无实质内容 → `dead_link / soft_404`
15. HTTP 200 兜底 → `accessible / 0.75`
16. 未知 → `review_required / 0.4`

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
- `BrowserProbeResult.networkSamples`：L2 监听 `xhr`/`fetch` 响应，记录经 `stripTrackingParams` 的 URL、HTTP 状态、方法与 JSON/文本**脱敏节选**（写入 `Evidence` 与 AI 上下文）。**原始节选条目本身**不自动判死链；另有 `matchNetworkDeadDomSignals` 在满足 D-015 白名单时追加 `domSignals.network_api_removed`。

### `Evidence`（前端展示主路径，D-010）
- `finalUrl` = `canonicalizeFinalUrl(浏览器优先 → HTTP → 原 URL)` — 已去追踪参数（D-003）
- `httpFinalUrl / browserFinalUrl` = 原始 URL（仅供排查）
- `redirectChain`、`pageTitle`、`textSnippet`、`screenshotPath`（有截图时为 `{taskUrlId}.jpg`；**展示**走 `GET /api/tasks/:taskId/urls/:taskUrlId/screenshot`，见 D-017）、`platform`、`signals`
- `verifiedBy` = `'http' | 'browser' | 'ai' | 'rule'`
- `verificationNote` = HTTP 与最终结论冲突或网络拒连场景下的可读说明
- `networkSamples`（可选）：与 L2 同源，XHR/Fetch 取证数组，供结果卡与人工/AI 排查（D-014）
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
| 加用户下架屏幕文案 | `screen_hints` + `ScreenHintsModule` + L2 子串匹配 + `applyRules` 中 `user_screen_hint` |
| 加受控 XHR 下架子串规则 | `platform-network-dead-hints.ts`（含微博/快手等 REST 锚点规则，D-019）+ `BrowserProbeService` 合并 domSignals + `applyRules` 中 `network_json_removed` |
| 批量导入屏幕提示 | `POST /api/screen-hints/import` + `ScreenHintsService.importMany` |
| 加新 `verifiedBy` 值 | `types.ts` Evidence + ResultCard `VERIFIED_LABEL` |

## 数据库

Prisma + Postgres。Schema 位于 `apps/api/prisma/schema.prisma`：

`Task → TaskUrl → { HttpProbe, BrowserProbe, Classification, AiJudgement }`，另 **`ScreenHint`**（用户维护的下架提示子串，不入任务子图）。

`Classification.evidence` 是 `Json` 列承载 `Evidence` 对象 — 改 Evidence 字段无需迁移，但**前端必须容忍历史任务里没有新字段**。

---

## 异步与并发

- Bull 队列名 `probe`，并发 `concurrency: 10`。
- 每个 URL 失败时会 `retry × 3` with exponential backoff（`tasks.service.ts` 中的 `addBulk` 配置）。
- 队列依赖 Redis（`REDIS_HOST/PORT/PASSWORD`）；DB 通过 `DATABASE_URL`。

---

## 前端

- Next.js 14 App Router，`apps/web/src/app/page.tsx` 是聊天式提交入口；`history/page.tsx` 是历史任务列表。
- **默认 API 访问**：未配置 `NEXT_PUBLIC_API_URL` 时，浏览器请求走**同源**路径 `/api/*`，由 `next.config.js` rewrites 转发到 Nest（`API_URL`，默认 `http://127.0.0.1:3001/api`），避免 LAN IP 访问前端时的 CORS；截图 `<img>` 使用 `getWebVisibleApiRoot()` 同源策略一致。
- `ResultCard.tsx` 是单 URL 的展开卡，**唯一被允许直接读 `evidence.*` 的组件**（D-010）。
- 前端不维护自己的 `Evidence` 类型副本，全部从 `@linkscope/shared` 导入。
