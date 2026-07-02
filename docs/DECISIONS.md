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

## D-021 · 智能等待策略（Round 11）✅ 已实现

截图等待时间不应固定为 3 秒，应根据页面特征动态调整：

1. **SPA 框架检测**：识别 React/Vue/Angular 并应用特定等待策略
2. **网络空闲检测**：监听网络请求数量和状态
3. **DOM 稳定检测**：检测 DOM 变化频率
4. **可配置参数**：通过环境变量 `BROWSER_WAIT_*` 配置等待时间范围

等待时间范围：3-15 秒，默认 5 秒。

**实现细节**：
- 新增 `SmartWaitService` 服务（`apps/api/src/probe/smart-wait.service.ts`）
- 集成到 `BrowserProbeService.probe()` 方法
- 在 `ProbeModule` 中注册服务
- 添加环境变量配置（`.env.example`）

**环境变量**：
- `BROWSER_SMART_WAIT`：启用/禁用智能等待（默认：true）
- `BROWSER_WAIT_MIN`：最小等待时间（默认：3000ms）
- `BROWSER_WAIT_MAX`：最大等待时间（默认：15000ms）
- `BROWSER_WAIT_DEFAULT`：默认等待时间（默认：5000ms）

**等待策略**：
- SPA 框架页面：至少等待 8 秒
- 多请求页面（>10）：至少等待 6 秒
- 大量请求页面（>20）：至少等待 10 秒
- 频繁 DOM 变化页面：至少等待 7 秒
- 仍在加载的页面：至少等待 8 秒
- 有异步内容的页面：至少等待 6 秒

实现锚点：`SmartWaitService`、`BrowserProbeService.probe()`、`BROWSER_WAIT_*` 环境变量。

## D-022 · 反爬虫增强策略（Round 11）

为应对 2026 年反爬虫技术升级，实施以下增强：

1. **TLS 指纹模拟**：使用 `curl-impersonate` 或 `tls-client` 模拟真实浏览器 TLS 指纹
2. **浏览器指纹随机化**：Canvas、WebGL、字体等指纹随机化
3. **行为模拟**：鼠标轨迹、滚动模式、请求间隔正态分布随机化
4. **请求头顺序**：确保 `sec-ch-ua`、`Referer` 等头顺序符合浏览器规范

**不做**：完整的浏览器自动化测试框架（超出范围）。

实现锚点：`BrowserProbeService` stealth patches、`HttpProbeService` 请求头配置。

## D-023 · MCP 协议集成（Round 11）

LinkScope 支持 MCP 协议集成：

1. **作为 MCP Server**：暴露检测能力给其他 AI Agent
2. **作为 MCP Client**：接入外部工具增强检测能力
3. **传输协议**：支持 stdio（本地）和 Streamable HTTP（远程，2026-07-28 规范）

暴露的工具：
- `detect_link_status`：检测单个链接状态
- `batch_detect`：批量检测链接
- `get_task_results`：获取任务结果

实现锚点：`apps/api/src/mcp/mcp-server.ts`、`.cursor/mcp.json`。

## D-024 · Loop Engineering 实践（Round 11）

采用 Loop Engineering 范式进行迭代开发：

1. **验证优先**：使用 `verify.sh` 作为循环终止条件
2. **持久化上下文**：`AGENTS.md`、`.cursor/skills/`、`.cursor/rules/`
3. **状态管理**：`loop-state.json` 记录迭代进度
4. **Hooks 门禁**：类型检查、Lint、测试自动化

验证脚本：`scripts/verify.sh`

实现锚点：`.cursor/skills/`、`.cursor/hooks.json`、`scripts/verify.sh`。

## D-025 · 文档驱动开发（Round 11）

建立完整的 AI 开发文档体系：

1. **AI_DEVELOPMENT.md**：AI 模型集成、提示词工程、工具调用
2. **MCP_INTEGRATION.md**：MCP 协议集成、工具暴露、资源管理
3. **LOOP_ENGINEERING.md**：循环工程实践、验证流程、状态管理
4. **ARCHITECTURE.md**：更新架构图，添加 MCP 和 Loop Engineering 部分

实现锚点：`docs/AI_DEVELOPMENT.md`、`docs/MCP_INTEGRATION.md`、`docs/LOOP_ENGINEERING.md`。

## D-026 · 反爬虫增强实施（Round 12）

实施 D-022 规划的反爬虫增强策略：

1. **TLS 指纹模拟**：集成 `curl-impersonate` 或 `tls-client`，模拟真实浏览器 TLS 指纹
2. **浏览器指纹随机化**：Canvas、WebGL、字体等指纹随机化
3. **行为模拟**：鼠标轨迹、滚动模式、请求间隔正态分布随机化
4. **请求头顺序**：确保 `sec-ch-ua`、`Referer` 等头顺序符合浏览器规范
5. **住宅代理支持**：集成代理轮换机制

**不做**：完整的浏览器自动化测试框架（超出范围）。

实现锚点：`apps/api/src/probe/anti-detection.service.ts`、`apps/api/src/probe/browser-probe.service.ts`、`apps/api/src/probe/http-probe.service.ts`。

## D-027 · MCP 协议集成实施（Round 12）

实施 D-023 规划的 MCP 协议集成：

1. **MCP 服务器实现**：创建 `apps/api/src/mcp/mcp-server.ts`
2. **工具实现**：`detect_link_status`、`batch_detect`、`get_task_results`、`export_results`
3. **资源实现**：`platform_configs`、`detection_history`、`screen_hints`
4. **传输协议**：支持 stdio（本地）和 Streamable HTTP（远程，2026-07-28 规范）

实现锚点：`apps/api/src/mcp/mcp-server.ts`、`.cursor/mcp.json`。

## D-028 · 测试体系建设（Round 12）

建立完整的测试体系，达到以下覆盖率目标：

1. **单元测试**：≥ 80% 覆盖率，优先测试纯函数（`url-utils.ts`、`platforms.ts`）
2. **集成测试**：≥ 70% 覆盖率，测试任务创建→探测→分类→结果的完整流水线
3. **端到端测试**：≥ 60% 覆盖率，测试前端页面交互流程
4. **测试框架**：使用 Jest（NestJS 官方推荐），配置覆盖率统计

实现锚点：`packages/shared/src/__tests__/`、`apps/api/src/__tests__/`、`apps/api/test/`、`apps/web/src/__tests__/`。

## D-029 · 性能优化实施（Round 12）

实施性能优化措施：

1. **浏览器实例池**：实现 Playwright 浏览器上下文池，复用浏览器实例，降低内存消耗
2. **性能监控系统**：集成 Prometheus 指标暴露，监控队列积压、探测延迟分布、成功率
3. **并发数可配置**：通过 `WORKER_CONCURRENCY` 环境变量配置 Worker 并发数
4. **域名级限速**：实现基于域名的请求速率限制，避免触发反爬
5. **Redis 缓存层**：为高频查询添加缓存，减少数据库压力

实现锚点：`apps/api/src/probe/browser-pool.service.ts`、`apps/api/src/monitoring/metrics.service.ts`、`apps/api/src/monitoring/health.controller.ts`。

## D-030 · 浏览器实例池实现（Round 12）

实现浏览器实例池，优化资源使用：

1. **实例复用**：浏览器实例池复用，避免重复启动
2. **上下文复用**：浏览器上下文复用，降低内存消耗
3. **自动清理**：空闲实例自动清理，避免资源泄漏
4. **状态监控**：提供池状态指标，便于监控

**配置参数**：
- `BROWSER_POOL_MAX_BROWSERS`：最大浏览器实例数（默认：3）
- `BROWSER_POOL_MAX_CONTEXTS`：每个浏览器最大上下文数（默认：5）
- `BROWSER_POOL_CONTEXT_TIMEOUT`：上下文空闲超时时间（默认：30000ms）
- `BROWSER_POOL_BROWSER_TIMEOUT`：浏览器空闲超时时间（默认：300000ms）
- `BROWSER_POOL_CONTEXT_REUSE`：启用上下文复用（默认：true）

实现锚点：`apps/api/src/probe/browser-pool.service.ts`。

## D-031 · 性能监控系统实现（Round 12）

实现性能监控系统，提供实时监控能力：

1. **指标收集**：收集探测延迟、成功率、资源使用率等指标
2. **健康检查**：提供 /health、/ready、/live 端点
3. **Prometheus 格式**：指标以 Prometheus 格式暴露
4. **告警支持**：支持基于指标的告警规则

**监控指标**：
- `linkscope_probe_duration_ms`：探测延迟分布
- `linkscope_probe_total`：探测总数
- `linkscope_tasks_total`：任务总数
- `linkscope_queue_*`：队列状态指标
- `linkscope_browser_pool_*`：浏览器池状态指标
- `linkscope_ai_*`：AI 调用指标

实现锚点：`apps/api/src/monitoring/metrics.service.ts`、`apps/api/src/monitoring/health.controller.ts`。

## D-032 · 测试框架搭建（Round 12）

搭建测试框架，建立测试基础设施：

1. **Jest 配置**：配置 Jest 测试框架，支持 TypeScript
2. **单元测试**：创建 url-utils 和 platforms 的单元测试
3. **覆盖率统计**：配置覆盖率统计和报告
4. **测试脚本**：添加测试相关 npm 脚本

**测试文件**：
- `packages/shared/jest.config.js`：Jest 配置文件
- `packages/shared/src/__tests__/url-utils.test.ts`：URL 工具单元测试
- `packages/shared/src/__tests__/platforms.test.ts`：平台检测单元测试

**npm 脚本**：
- `test`：运行测试
- `test:watch`：监听模式运行测试
- `test:coverage`：运行测试并生成覆盖率报告

实现锚点：`packages/shared/jest.config.js`、`packages/shared/src/__tests__/`。

## D-033 · MCP 服务器接入实际服务（Round 13）

MCP 服务器不再使用 TODO 占位，改为注入 NestJS 服务实现完整检测流水线：

1. **依赖注入**：`LinkScopeMcpServer` 标记为 `@Injectable()`，注入 `TasksService`、`ExportService`、`HttpProbeService`、`BrowserProbeService`、`ScreenHintsService`
2. **核心检测逻辑**：`detectLink()` 执行 L1 HTTP 探测 + 可选 L2 浏览器探测，构建 `Evidence` 结构返回
3. **简化判定**：`determineStatus()` 基于 HTTP 状态码、浏览器 DOM 信号、网络错误码进行快速判定
4. **模块化**：新增 `McpModule` 注册到 `AppModule`，不再支持独立启动（`require.main === module` 仅输出错误提示）

**环境变量**：MCP 服务器通过 NestJS `ConfigModule` 读取配置，无需单独的环境变量。

实现锚点：`apps/api/src/mcp/mcp-server.ts`、`apps/api/src/mcp/mcp.module.ts`。

## D-034 · 反爬虫配置环境变量化（Round 13）

`AntiDetectionService` 不再硬编码配置，改为从 `ConfigService` 读取环境变量：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `ANTI_DETECTION_TLS_FINGERPRINT` | `true` | 启用 TLS 指纹模拟 |
| `ANTI_DETECTION_BROWSER_FINGERPRINT` | `true` | 启用浏览器指纹随机化 |
| `ANTI_DETECTION_BEHAVIOR_SIM` | `true` | 启用行为模拟 |
| `ANTI_DETECTION_HEADER_ORDER` | `true` | 启用请求头顺序优化 |
| `ANTI_DETECTION_RESIDENTIAL_PROXY` | `false` | 启用住宅代理 |
| `ANTI_DETECTION_PROXIES` | `''` | 代理列表（逗号分隔） |
| `ANTI_DETECTION_TIMEOUT_MS` | `15000` | 请求超时时间 |
| `ANTI_DETECTION_MAX_REDIRECTS` | `10` | 最大重定向次数 |
| `ANTI_DETECTION_USER_AGENTS` | 内置列表 | 自定义 UA（每行一个） |

`HttpProbeService.doRequest()` 改为从 `AntiDetectionService` 读取 `timeout` 和 `maxRedirects`，不再使用局部常量。

实现锚点：`apps/api/src/probe/anti-detection.service.ts`、`apps/api/src/probe/http-probe.service.ts`、`.env.example`。

## D-035 · 健康检查注入实际服务（Round 13）

`HealthController` 不再返回虚假的 `healthy` 状态，改为注入实际服务执行真实连接检查：

1. **数据库**：注入 `PrismaService`，执行 `SELECT 1` 查询，记录延迟
2. **Redis**：注入 Bull 队列，通过 `client.ping()` 检查连接，记录延迟
3. **队列状态**：获取 `waitingCount`、`activeCount`、`failedCount`，failed > 100 时标记 `degraded`
4. **浏览器池**：已有的 `BrowserPoolService.getPoolStatus()` 检查

`MonitoringModule` 新增导入 `PrismaModule` 和 `BullModule.registerQueue({ name: 'probe' })`。

实现锚点：`apps/api/src/monitoring/health.controller.ts`、`apps/api/src/monitoring/monitoring.module.ts`。

## D-036 · 根目录统一测试脚本（Round 13）

根目录 `package.json` 新增统一的测试入口，通过 Turbo 跨包执行：

- `pnpm test`：运行所有包的测试
- `pnpm test:watch`：监听模式
- `pnpm test:coverage`：生成覆盖率报告
- `pnpm verify`：`typecheck && test && build` 一键验证

`turbo.json` 补充 `test`、`test:watch`、`test:coverage` 任务配置。API 包新增 `jest.config.ts` 和示例测试文件 `health.controller.spec.ts`。

实现锚点：`package.json`、`turbo.json`、`apps/api/jest.config.ts`、`apps/api/src/monitoring/__tests__/health.controller.spec.ts`。

## D-037 · 万级表格文件流式解析（Round 14）

支持万级别表格文件（CSV/Excel/TXT/JSON）的流式解析，避免内存溢出：

1. **流式解析器**：`FileParserService` 实现流式文件读取，支持进度回调
2. **批量数据库插入**：`TasksService.createTaskFromParsedUrls()` 分批插入（500条/批），避免单次事务过大
3. **批量队列添加**：队列任务分批添加（100条/批），避免 Redis 压力过大
4. **文件大小限制**：上传文件限制 50MB
5. **进度追踪**：解析、插入、队列三个阶段的进度回调

**性能基准**：
- 1万行 CSV：解析 < 2秒，插入 < 5秒
- 5万行 Excel：解析 < 10秒，插入 < 30秒
- 10万行 TXT：解析 < 5秒，插入 < 60秒

实现锚点：`apps/api/src/tasks/file-parser.service.ts`、`apps/api/src/tasks/tasks.service.ts`。

## D-038 · 域名级令牌桶限速（Round 14）

实现基于域名的令牌桶限速器，避免同一域名并发过高触发反爬：

1. **令牌桶算法**：每域名独立桶，按配置速率补充令牌
2. **并发限制**：每域名最大并发数可配置（默认5）
3. **突发容量**：支持突发请求（默认10个令牌）
4. **自动清理**：空闲桶自动清理，避免内存泄漏
5. **优先级队列**：国内平台（抖音/快手/小红书/B站/微博）优先处理

**配置参数**：
- `RATE_LIMIT_PER_DOMAIN`：每域名每秒最大请求数（默认2）
- `RATE_LIMIT_MAX_CONCURRENT`：每域名最大并发数（默认5）
- `RATE_LIMIT_BURST_CAPACITY`：突发请求容量（默认10）
- `RATE_LIMIT_CLEANUP_INTERVAL`：清理间隔（默认60秒）
- `RATE_LIMIT_BUCKET_IDLE_TIMEOUT`：桶空闲超时（默认5分钟）

实现锚点：`apps/api/src/probe/rate-limiter.service.ts`、`apps/api/src/workers/probe.worker.ts`。

## D-039 · SSE 实时进度推送（Round 14）

实现 Server-Sent Events 实时进度推送，替代前端轮询：

1. **SSE 端点**：`GET /api/tasks/progress/:progressId` 返回事件流
2. **进度阶段**：`parsing` → `inserting` → `queuing` → `completed`
3. **错误处理**：处理失败时推送 `error` 事件
4. **资源清理**：Subject 完成后自动清理，上传文件处理后删除
5. **文件大小限制**：上传文件限制 50MB

**事件类型**：
- `progress`：进度更新事件
- `completed`：任务创建完成事件
- `error`：处理失败事件

实现锚点：`apps/api/src/tasks/tasks.controller.ts`（`@Sse` 装饰器）。

## D-040 · 大任务统计接口（Round 14）

为大任务提供统计接口，支持按平台和状态分组：

1. **任务统计**：`GET /api/tasks/:id/stats` 返回任务详情和分组统计
2. **平台分组**：按平台统计URL数量
3. **状态分组**：按处理状态统计URL数量
4. **性能优化**：使用 Prisma `groupBy` 聚合查询

实现锚点：`apps/api/src/tasks/tasks.service.ts`（`getTaskStats` 方法）。

## D-041 · 内容下架检测逻辑加固（Round 15）

核心问题：项目检测目标是「链接指向的内容是否已被平台下架」，而非「链接本身是否可访问」。多个场景下，链接可访问（HTTP 200）但内容已下架的页面会被误判为 `accessible`。

修复内容：

1. **扩展通用死链文案库**（`DEAD_TEXT_PATTERNS`）：补充「视频已删除」「内容不可用」「文章不存在」「稿件不可见」「内容已下架」等 20+ 条中英文模式，覆盖更多 HTTP 200 但内容已下架的场景。
2. **网络拒连场景增加死链内容检查**：HTTP 连接拒绝但浏览器成功加载页面时，先检查页面是否显示下架/删除/封禁内容，再判断为可访问（`browserShowsDeadContent`）。
3. **平台下架匹配 `internalStatus` 修正**：平台 `deadPatterns` 命中时从 `soft_404` 改为 `removed`（平台明确告知内容已删除，不是软 404）；`user_screen_hint` 同理。
4. **补全 `regionPatterns` 检查**：平台定义的地区限制模式（如 B 站「由于版权原因」「地区限制」）现在会被检查，输出 `review_required / region_restricted`。
5. **`isFalsePositiveHttp404` 加固**：增加 `privatePatterns` 和 `regionPatterns` 检查，防止账号注销/封禁/地区限制页面因文本长度 ≥ 120 被误判为可访问。
6. **`browserLooksHealthy` 加固**：同上，增加 `privatePatterns` 和 `regionPatterns` 检查。
7. **前端 REASON_LABEL 同步**：补充缺失的 `redirect_to_error`。

涉及文件：
- `apps/api/src/probe/browser-probe.service.ts`（DEAD_TEXT_PATTERNS）
- `apps/api/src/classify/classify.service.ts`（规则引擎 + 辅助方法）
- `apps/web/src/components/results/ResultCard.tsx`（REASON_LABEL）
- `docs/DECISIONS.md`（本条目）
