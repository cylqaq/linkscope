# 当前迭代计划窗

> **约定**：下一轮迭代开始前，可删除下方「上轮摘要」中已过时的单行描述，在「下轮占位」重写计划；合并上线后勿保留大段过时方案正文。

## 上轮摘要（2026-05-13 · Round 3 · 网络拒连识别 + AI 复核三态化）

- **问题反馈**：
  1. 抖音短链被升级为可访问后，AI 没被触发，用户对「AI 是否生效」失去可见度。
  2. `qzxy.tyut.edu.cn` 这种 `ERR_CONNECTION_CLOSED / ECONNRESET` 等连接级错误未被识别为失效，落到 `unknown / 复核`。

- **根因**：
  - HTTP 层只识别 `timeout / dns_failed / ssl_error`，未细分 `ECONNREFUSED / ECONNRESET / EPIPE / EHOSTUNREACH / ENETUNREACH`，对应 `ReasonCode` 也缺。
  - `shouldUseAi` 仅看 `(internalStatus, confidence)`，规则一旦 ≥ 0.9 就完全不调 AI，反爬覆盖等"我违反 HTTP 表面信号"的高风险结论缺乏二次校验。
  - AI 调用对前端不透明：成功/失败/未触发都呈现为同样的"无 AI 理由"。

- **措施**：
  - **HTTP 层错误码细化**：`HttpProbeService.mapAxiosErrorCode` 把 axios `code` 与 message 双路识别为 `connection_refused / connection_reset / connection_closed / unreachable`；导出常量 `NETWORK_REFUSAL_ERROR_CODES`。
  - **浏览器层错误码归一**：`BrowserProbeService.mapNavigationError` 解析 Chromium `ERR_CONNECTION_*` / `NS_ERROR_*` 等，与 HTTP 层共用同一组 reasonCode，形成"两路一致 → 高置信死链"。
  - **`shouldTriggerBrowserFallback` 重写**：连接级错误一律走浏览器二次校验（无论是否社交平台），`timeout / dns_failed` 不再徒增成本。
  - **`ClassifyService` 重构**：拆为 `applyRules → buildEvidence → decideAiUse → runAi → fuse`；新增 `RuleVerdict` 工厂常量；`decideAiUse` 由 `(rule, http, browser)` 联合决定，并附带 `triggerReason`：
    - `http_status_conflict`：HTTP 4xx 但规则升级为 accessible — 必跑 AI。
    - `connection_failure_double_check`：连接拒绝/超时 — 必跑 AI（让 AI 用 `fetch_url_rendered` 真验）。
    - `low_confidence / ambiguous_status`：补强模糊态。
    - 其它（高置信规则）显式 `skipped: rule_confident`。
  - **AI 兜底融合**：当 `triggerReason` 是反爬覆盖且 AI 不同意 → 回退 `review_required`；当连接拒连场景 AI 用浏览器证明可访问 → 反转为 accessible（≤ 0.9）。
  - **`AiVerdict` 三态化**：`{ state: 'agree' | 'disagree' | 'skipped' | 'failed' }` 写入 `evidence.aiVerdict`，前端 `ResultCard` 在「AI 复核」行明确展示同意/反对（含倾向决策与理由）/未触发（含原因）/失败。
  - **AI 提示词 v1.3.0**：把 `httpErrorCode` 与 `triggerReason` 喂给模型，引导它在 `http_status_conflict / connection_failure_double_check` 场景**优先调用 `fetch_url_rendered`**；扩充 `reasonCode` 枚举包含连接级错误。
  - **导出与 UI**：CSV/XLSX 与 ResultCard 同步新增 `connection_refused / connection_reset / connection_closed / unreachable` 的中文展示。
  - **仓库清理**：删除 `packages/shared/src/*.{js,d.ts,*.map}` 早期错位编译产物（`outDir/rootDir` 已规范，未来不会再出现）。

- **涉及文件**：
  - `packages/shared/src/{types.ts,url-utils.ts}`（types 增 `connection_*`、`unreachable`、`AiVerdict`、AI 输入新字段）
  - `apps/api/src/probe/{http-probe.service.ts,browser-probe.service.ts}`（错误码细分）
  - `apps/api/src/classify/classify.service.ts`（重写）
  - `apps/api/src/ai/ai.service.ts`（系统提示词 v1.3.0、新增 trigger hint）
  - `apps/api/src/export/export.service.ts`（reason 翻译扩充）
  - `apps/web/src/components/results/ResultCard.tsx`（AI 复核状态行 + 新 reason 翻译）

## 下轮占位（下一轮填写，合并后清空本节）

（空白）
