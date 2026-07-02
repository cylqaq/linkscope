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
10. 平台 dead/login/private/**region** patterns
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

---

## MCP 集成架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cursor IDE    │     │  Other AI Agent │     │   External      │
│   (MCP Client)  │     │  (MCP Client)   │     │   Services      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ MCP Protocol          │ MCP Protocol          │
         │ (stdio/HTTP)          │ (HTTP)                │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LinkScope MCP Server                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Tools     │  │  Resources  │  │   Prompts   │            │
│  │             │  │             │  │             │            │
│  │ detect_link │  │ platform_   │  │ detection_  │            │
│  │ batch_      │  │ configs     │  │ prompt      │            │
│  │ detect      │  │ history     │  │             │            │
│  │ get_results │  │ hints       │  │             │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Internal API
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LinkScope Core Engine                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  L1 HTTP    │  │  L2 Browser │  │  L3 AI      │            │
│  │  Probe      │  │  Probe      │  │  Judge      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### MCP 工具列表

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `detect_link_status` | 检测单个链接状态 | `url`, `options?` |
| `batch_detect` | 批量检测链接 | `urls[]`, `options?` |
| `get_task_results` | 获取任务结果 | `taskId` |
| `export_results` | 导出结果 | `taskId`, `format` |

### MCP 资源列表

| 资源名 | URI | 描述 |
|--------|-----|------|
| `platform_configs` | `linkscope://platforms` | 平台配置列表 |
| `detection_history` | `linkscope://history` | 检测历史 |
| `screen_hints` | `linkscope://hints` | 屏幕提示规则 |

### 传输协议

- **stdio**：本地 Cursor 集成
- **Streamable HTTP**：远程服务（2026-07-28 规范）

---

## Loop Engineering 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cursor IDE                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   /loop     │  │  Automations│  │   Hooks     │            │
│  │   Command   │  │  (Cloud)    │  │  (Local)    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Loop Engine                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   State     │  │  Validator  │  │   Agent     │            │
│  │   Manager   │  │  (verify.sh)│  │   Loop      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Verification                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ TypeCheck   │  │    Lint     │  │   Tests     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件

1. **State Manager**：管理循环状态（`loop-state.json`）
2. **Validator**：运行验证脚本（`verify.sh`）
3. **Agent Loop**：执行迭代循环

### 验证流程

```
开始 → 读取状态 → 执行修改 → 运行验证 → 通过？
  │                                    │
  │                                    ▼
  │                              ┌─────────┐
  │                              │  失败   │
  │                              └────┬────┘
  │                                   │
  ▼                                   ▼
结束 ←─────────────────────────── 继续循环
```

---

## 反爬虫增强架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    请求层                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ TLS 指纹    │  │ HTTP/2      │  │ 请求头      │            │
│  │ 模拟        │  │ 帧特征      │  │ 随机化      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    浏览器层                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ 指纹随机化  │  │ 行为模拟    │  │ 隐身模式    │            │
│  │             │  │ (鼠标轨迹) │  │             │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    等待策略                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ 网络空闲    │  │ DOM 稳定    │  │ SPA 框架    │            │
│  │ 检测        │  │ 检测        │  │ 特定等待    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### 关键技术

1. **TLS 指纹模拟**：使用 `curl-impersonate` 或 `tls-client`
2. **浏览器指纹随机化**：Canvas、WebGL、字体等
3. **行为模拟**：鼠标轨迹、滚动模式、请求间隔
4. **智能等待**：基于页面特征动态调整等待时间

### 实现组件

- **AntiDetectionService**：反爬虫服务，提供指纹随机化、行为模拟、请求头随机化
- **BrowserPoolService**：浏览器实例池，复用浏览器实例，降低内存消耗
- **SmartWaitService**：智能等待服务，根据页面特征动态调整等待时间

---

## 文档规范与边界

### 文档更新原则

**必须更新文档的场景**：
1. 新增或修改分层（L1/L2/L3）
2. 新增或修改数据契约（`Evidence`、`ReasonCode` 等）
3. 新增或修改扩展点
4. 新增或修改架构图
5. 新增或修改性能基准

**更新流程**：
1. 修改代码前先读 `DECISIONS.md` 相关条目
2. 修改后更新本文档对应章节
3. 在 `DECISIONS.md` 追加新条目（D-NNN）
4. 必要时更新其他相关文档

### 边界限制（NEVER）

1. **不破坏分层架构**：L1/L2/L3 职责严格分离，不得跨层调用
2. **不绕过数据契约**：所有数据必须通过 `Evidence` 传递，不得绕过
3. **不修改已发布的 ReasonCode**：已使用的 ReasonCode 只能废弃，不能修改
4. **不跳过证据链**：每个判定必须有可追溯的证据链

### 架构设计原则

**必须遵循的原则**：
1. **单一职责**：每个组件只做一件事
2. **依赖倒置**：高层模块不依赖低层模块
3. **接口隔离**：使用最小接口
4. **开闭原则**：对扩展开放，对修改关闭

**禁止的架构模式**：
1. 循环依赖
2. 跨层直接调用
3. 全局状态共享
4. 硬编码配置

### 数据契约规范

**必须遵循的规范**：
1. **唯一来源**：所有类型定义在 `@linkscope/shared`
2. **向后兼容**：新增字段必须可选
3. **版本控制**：类型变更必须记录在 `DECISIONS.md`
4. **文档同步**：类型变更必须同步更新文档

**Evidence 字段规范**：
- 必须可追溯到探测结果
- 必须可解释给用户
- 必须可序列化为 JSON
- 必须可持久化到数据库

### 扩展点规范

**新增扩展点的流程**：
1. 在本文档「扩展点速查」表格中添加条目
2. 在 `DECISIONS.md` 中记录决策
3. 在 `packages/shared` 中添加类型定义
4. 在 `apps/api` 中实现逻辑
5. 在 `apps/web` 中添加展示

**扩展点命名规范**：
- 使用 `snake_case` 命名
- 动词开头：`add_`、`modify_`、`remove_`
- 名词结尾：`_platform`、`_error_code`、`_rule`

### 性能基准

**必须满足的性能要求**：
- L1 HTTP 探测延迟：≤ 5 秒
- L2 浏览器探测延迟：≤ 30 秒
- L3 AI 判定延迟：≤ 10 秒
- 端到端延迟：≤ 60 秒

**性能监控指标**：
1. 各层探测延迟分布
2. 探测成功率
3. 资源使用率（CPU、内存、网络）
4. 队列积压情况

### 性能监控架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    监控层                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Metrics     │  │ Health      │  │ Alerting    │            │
│  │ Service     │  │ Controller  │  │ Service     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    指标收集                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ 探测延迟    │  │ 探测成功率  │  │ 资源使用率  │            │
│  │ Histogram   │  │ Counter     │  │ Gauge       │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    健康检查                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ /health     │  │ /ready      │  │ /live       │            │
│  │ 综合状态    │  │ 就绪检查    │  │ 存活检查    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### 实现组件

- **MetricsService**：指标收集服务，提供 Prometheus 格式指标
- **HealthController**：健康检查控制器，提供 /health、/ready、/live 端点
- **BrowserPoolService**：浏览器实例池，提供池状态指标

### 安全规范

**必须实施的安全措施**：
1. 输入验证：所有 URL 必须验证
2. 输出脱敏：敏感信息必须脱敏
3. 访问控制：API 必须认证
4. 审计日志：所有操作必须记录

**禁止的安全行为**：
1. 记录敏感信息（API Key、密码等）
2. 绕过权限控制
3. 跳过输入验证
4. 暴露内部实现细节

### 测试规范

**必须测试的场景**：
1. 各层探测逻辑
2. 数据契约验证
3. 扩展点功能
4. 性能基准验证

**测试覆盖率要求**：
- 单元测试：≥ 80%
- 集成测试：≥ 70%
- 端到端测试：≥ 60%

### 监控与告警规范

**必须监控的指标**：
1. 探测成功率（目标：≥ 95%）
2. 探测延迟（目标：P95 ≤ 60秒）
3. 错误率（目标：≤ 5%）
4. 资源使用率（目标：≤ 80%）

**告警阈值**：
- 探测成功率 < 90%：立即告警
- 探测延迟 P95 > 120秒：警告
- 错误率 > 10%：立即告警
- 资源使用率 > 90%：警告

---

## 万级表格文件处理架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    文件上传层                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Multer      │  │ 文件大小    │  │ 格式验证    │            │
│  │ 中间件      │  │ 限制 50MB   │  │ (xlsx/csv)  │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    流式解析层                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ FileParser  │  │ CSV/Excel   │  │ 进度回调    │            │
│  │ Service     │  │ 流式读取    │  │ SSE推送     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    批量存储层                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Prisma      │  │ 分批插入    │  │ 去重处理    │            │
│  │ createMany  │  │ 500条/批    │  │ dedupeKey   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    限速队列层                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Bull Queue  │  │ 域名级      │  │ 优先级队列  │            │
│  │ 批量添加    │  │ 令牌桶限速  │  │ 国内平台优先│            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件

1. **FileParserService**：流式文件解析器
   - 支持 CSV、Excel、TXT、JSON 格式
   - 进度回调机制
   - URL 提取和规范化

2. **RateLimiterService**：域名级令牌桶限速器
   - 每域名独立令牌桶
   - 并发限制（默认5）
   - 突发容量（默认10）
   - 自动清理空闲桶

3. **TasksService**：任务服务（优化版）
   - 批量数据库插入（500条/批）
   - 批量队列添加（100条/批）
   - 优先级队列（国内平台优先）

### 性能基准

| 文件规模 | 解析时间 | 插入时间 | 队列添加 | 总时间 |
|---------|---------|---------|---------|--------|
| 1万行 CSV | < 2秒 | < 5秒 | < 2秒 | < 10秒 |
| 5万行 Excel | < 10秒 | < 30秒 | < 5秒 | < 45秒 |
| 10万行 TXT | < 5秒 | < 60秒 | < 10秒 | < 75秒 |

### 配置参数

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `RATE_LIMIT_PER_DOMAIN` | 2 | 每域名每秒最大请求数 |
| `RATE_LIMIT_MAX_CONCURRENT` | 5 | 每域名最大并发数 |
| `RATE_LIMIT_BURST_CAPACITY` | 10 | 突发请求容量 |
| `RATE_LIMIT_CLEANUP_INTERVAL` | 60000 | 清理间隔（毫秒） |
| `RATE_LIMIT_BUCKET_IDLE_TIMEOUT` | 300000 | 桶空闲超时（毫秒） |
