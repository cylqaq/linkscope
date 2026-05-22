# LinkScope · 决策原则

> **仅追加，不改写**。每条标注产生轮次。新原则不要破坏旧原则；必须推翻时显式追加"超越"条目并保留历史。

## D-001 · 不信任纯 HTTP 单源（Round 1）

社交/短视频站对 axios 等 HTTP 客户端常返回反爬 404/429/503/无状态。**对 `detectPlatform()` 命中的域，HTTP 4xx 必须由 L2 浏览器二次校验后再判死链**。

实现锚点：`HttpProbeService.shouldTriggerBrowserFallback`、`ClassifyService.applyRules` 的反爬 404 分支。

## D-002 · 浏览器作为仲裁器（Round 1, 2）

当 L1 与「常识/最终结论」矛盾时，**以 L2 文本与 finalUrl 路径为主信号**：

- 抖音 `/video/<id>`、B 站 `/video/BV<x>`、小红书 `/explore/<id>` 等命中即视作命中内容。
- L2 拿到正文 ≥ 120 字也视作命中。

实现锚点：`ClassifyService.isFalsePositiveHttp404`、`browserHasMeaningfulContent`、`browserLooksHealthy`。

## D-003 · 最终 URL 必须 canonical + 去追踪参数（Round 2）

展示给用户的 `evidence.finalUrl` 必须经 `canonicalizeFinalUrl` 处理（浏览器层优先），不得保留 `previous_page / share_token / spm / sec_uid / xsec_token / vd_source` 等。原始 URL 留在 `httpFinalUrl / browserFinalUrl` 供排查。

实现锚点：`packages/shared/src/url-utils.ts` 的 `PLATFORM_TRACKING_PARAMS / stripTrackingParams / canonicalizeFinalUrl`。

## D-004 · AI 失败不得污染证据（Round 2）

`AiService.judge` 必须返回 `succeeded` 标志。失败时：

- **不写 `aiJudgement` 行**；
- **不把 `sourceOfTruth` 升为 `rule_plus_ai`**；
- **不在 reasoning 字段塞入 "AI判定失败" 之类误导文案**。

前端从 `evidence.aiVerdict.state === 'failed'` 显示真实状态。

实现锚点：`AiService.judge` 返回类型，`ClassifyService.runAi`，`ResultCard.tsx` 的 `AiVerdictRow`。

## D-005 · AI 是必须的二次复核者，不是「兜底备胎」（Round 3）

对两类高风险结论 **无视规则置信度也必须调 AI**：

- `http_status_conflict`：HTTP 4xx 但规则升级为 accessible。
- `connection_failure_double_check`：连接拒绝/超时。

AI 结果必须以 `AiVerdict` 四态之一暴露给前端，让用户能看见"AI 是否参与、是否赞同"。

实现锚点：`ClassifyService.decideAiUse / fuseAiWithRules`、`AiService` 系统提示词。

## D-006 · 网络拒连归一与"两路一致"（Round 3）

`ECONNREFUSED / ECONNRESET / EPIPE / EHOSTUNREACH / ENETUNREACH` 与 Chromium `ERR_CONNECTION_*` / `NS_ERROR_*` 必须归一到同一组 ReasonCode（`connection_refused / connection_reset / connection_closed / unreachable`）。

- HTTP 与浏览器两路都报同类错误时直接判 `dead_link / 0.95`；
- 否则候选死链 `0.7` + AI 复核（D-005）。

实现锚点：`HttpProbeService.mapAxiosErrorCode`、`BrowserProbeService.mapNavigationError`、`NETWORK_REFUSAL_ERROR_CODES` 集合。

## D-007 · 规则 ≥ 0.9 默认跳过 AI；但反爬覆盖与拒连例外（Round 2, 3）

正常情况下规则置信 ≥ 0.9 不必再调 AI，避免烧 token。但 D-005 的两类场景例外。

实现锚点：`ClassifyService.decideAiUse` 的判断顺序（先看冲突 / 拒连，后看规则置信）。

## D-008 · 单窗口迭代文档（Round 1, 2, 3）

`docs/upgrade-plans/CURRENT.md` 是单窗口：合并上线后立即精简为单段摘要，并在本文件追加正式条目。**永远不在 `CURRENT.md` 中保留多轮过期方案正文**。

## D-009 · 源码目录禁止编译产物（Round 3）

`packages/shared` 与 `apps/api` 的 `tsconfig.json` 必须显式 `outDir/rootDir`。任何 `src/**/*.{js,d.ts,*.map}` 出现都视为污染，**必须立即清理**。

实现锚点：`packages/shared/tsconfig.json`、`apps/api/tsconfig.json`、`.gitignore`。

## D-010 · 前端展示必须可解释（Round 1, 2, 3）

前端展示的每个字段都必须能溯源到 `Evidence` 中的某个字段或规则分支。**禁止前端从 `httpProbe.finalUrl` 直接取值（除非用于排查面板）**；展示主路径走 `evidence.*`。

实现锚点：`ResultCard.tsx` 的字段映射全部从 `cls.evidence` 取。

## D-011 · 跨端常量唯一来源（Round 4）

跨服务复用的字面量常量（如 User-Agent、追踪参数列表、ReasonCode 枚举、错误码常量集合）必须放在 `@linkscope/shared` 或在某个 service 中导出后由调用方 import。**禁止在多处复制粘贴同一个字符串字面量**（典型反例：以前 `USER_AGENT` 在 `HttpProbeService` 与 `AiService` 与 `BrowserProbeService` 各写一份）。

实现锚点：`packages/shared/src/url-utils.ts#DEFAULT_USER_AGENT`、`http-probe.service.ts#NETWORK_REFUSAL_ERROR_CODES`。

## D-012 · 文档驱动迭代（Round 4）

每轮迭代必须按 `AGENTS.md` 描述的工作纪律执行：

1. 开始前读 `ARCHITECTURE.md` + `DECISIONS.md` + `CURRENT.md`；
2. 收尾时精简 `CURRENT.md` 并在本文件追加 `D-NNN` 条目；
3. 不留过期方案正文与死代码。

接力 agent 跳过本流程视为违反约定。

## D-013 · 用户屏幕提示规则（Round 5）

用户可在 `/hints` 维护 `screen_hints`：**平台 slug**（`PLATFORM_CONFIGS.id` 或 `generic`）+ **页内可见子串**（默认不区分大小写）。L2 将命中写入 `domSignals`（`signal = user_screen_hint`，`hintId` 溯源）；L3 优先于内置 `dead_content_text` 命中，输出 `reasonCode = user_screen_hint`、`finalStatus = dead_link`（0.94），且仅在**最终** `reasonCode` 仍为 `user_screen_hint` 时递增 `hitCount`（避免 AI 改写后误计）。

实现锚点：`ScreenHint` 模型、`ScreenHintsModule`、`BrowserProbeService`、`ClassifyService.applyRules` / `maybeRecordUserHintHits`、`packages/shared` 的 `SCREEN_HINT_PLATFORM_SLUGS` 与 `DomSignal.hintId`。

## D-014 · L2 XHR/Fetch 取证边界（Round 5）

L2 可采集浏览器上下文中的 `xhr`/`fetch` 响应摘要写入 `networkSamples` 并进入 `Evidence` 与 AI 提示，用于「接口已报业务删除/错误码」与 DOM 文本交叉验证。**禁止**仅凭单条与主内容无关的 4xx（如静态资源、广告请求）自动判整 URL 为 `dead_link`；是否采纳由规则层其它信号、`user_screen_hint`、平台 pattern 或 AI 综合判断。

实现锚点：`BrowserProbeService` 响应监听与脱敏、`ClassifyService.buildEvidence`、`AiService` 用户消息与 system 提示（`1.3.x`）、`ResultCard` 展示。

## D-015 · XHR 受控下架子串规则表（Round 6）

在 `networkSamples` 基础上增加 **`packages/shared/src/platform-network-dead-hints.ts`**：每条规则须 **URL 多子串锚点**（含平台域名）且 **响应节选** 命中任一已知下架/错误文案（或 B 站 JSON `code:-404` 等），才写入 `domSignals.signal = network_api_removed`；L3 输出 `network_json_removed`（0.91），**优先级低于**用户 `user_screen_hint`。**禁止**未同时满足 URL 锚点与节选条件时仅凭 HTTP status 或孤立片段判死链。新增/放宽规则必须在真实页面回归并追加本条目或子 bullet。

实现锚点：`matchNetworkDeadDomSignals`、`BrowserProbeService`、`ClassifyService.applyRules` 与反爬辅助函数中的 fatal dom 集合、AI `1.3.2`。

## D-016 · 屏幕提示运营闭环（Round 7）

允许在**检测结果展开卡**（`QuickHintFromResult`）内直接调用 `POST /api/screen-hints` 写入规则，并支持跳转 `/hints?platform=&phrase=&note=` 预填表单。批量数据走 **`POST /api/screen-hints/import`**，body 为 `{ items: [...] }` 或与导出一致的 `{ hints: [...] }`；服务端跳过非法行及 **(platform, phrase) 与库内已存在行完全相同** 的重复项，返回 `{ created, skipped }`。导出 JSON 含 `version / exportedAt / hints` 字段便于版本化。

实现锚点：`ScreenHintsService.importMany`、`ScreenHintsController`、`apps/web` 的 `hints/page.tsx` 与 `ResultCard` / `QuickHintFromResult`。

## D-017 · L2 截图只读 HTTP 与路径安全（Round 8）

前端仅通过 **`GET /api/tasks/:taskId/urls/:taskUrlId/screenshot`** 拉取 JPEG；服务端须校验 `taskUrl` 属于该 `taskId` 且 `browserProbe.screenshotPath` 已记录，磁盘路径**仅**由 `SCREENSHOT_DIR` + `taskUrlId` + 固定扩展名拼接，并校验解析后的绝对路径落在目录前缀内（防路径穿越）。**不**把原始磁盘路径或任意用户输入拼进响应头/URL。未鉴权部署下该接口与任务结果同源暴露，后续若加鉴权须与此一致。

实现锚点：`TasksService.getScreenshotAbsolutePath`、`TasksController.getUrlScreenshot`、`ResultCard` 与 `getWebVisibleApiRoot()`（未配 `NEXT_PUBLIC_API_URL` 时为同源 `/api`，见 D-020）。

## D-018 · 截图元数据不落绝对路径（Round 9）

`BrowserProbe` / `Evidence.screenshotPath` 仅保存 **`{taskUrlId}.jpg`** 文件名，表示已落盘；**禁止**把服务器绝对路径写入 JSON 响应。磁盘读写目录由 `apps/api/src/screenshot-storage.ts#resolveScreenshotStorageDir` 与 `SCREENSHOT_DIR` 统一解析，避免 L2 写入与只读接口各算各的相对路径。

实现锚点：`browser-probe.service.ts`、`tasks.service.ts`、`packages/shared/src/types.ts` 字段注释。

## D-019 · XHR 下架规则扩展（微博 / 快手）（Round 9）

在 `PLATFORM_NETWORK_DEAD_HINT_RULES` 增加 **`weibo_aj_deleted`**（`weibo.com` + `aj` + 典型下架中文案）与 **`kuaishou_rest_deleted` / `kuaishou_gifshow_rest_deleted`**（`rest` 接口锚点 + 与平台 `deadPatterns` 对齐的节选），仍须满足 D-015 的 URL 多子串锚点 + 节选双条件；后续若在真实页发现误杀须收紧节选或追加超越条目。

实现锚点：`packages/shared/src/platform-network-dead-hints.ts`。

## D-020 · 前端默认同源 /api 与开发网段 CORS（Round 10）

未配置 `NEXT_PUBLIC_API_URL` 时，浏览器 API 与截图资源走 **`/api` + Next rewrites**（`API_URL` → Nest），避免通过局域网 IP 打开前端时的跨域失败；Nest 在非 production 下对 **RFC1918 私网 Origin** 放行 CORS，便于仍直连 API 的调试。生产环境应依赖同源或显式白名单，不依赖私网通配。

实现锚点：`apps/web/src/lib/api.ts`、`apps/web/next.config.js`、`apps/api/src/main.ts`。
