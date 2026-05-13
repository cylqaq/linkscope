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
