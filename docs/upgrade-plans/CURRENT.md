# 当前迭代窗口

> 单窗口约定（D-008 / D-012）：合并后只保留「上轮摘要」一段；下一轮开始前清空摘要正文，把要点同步追加到 `docs/DECISIONS.md`。
>
> 模板见文末「下轮占位」。

## 上轮摘要（2026-05-13 · Round 4 · 文档驱动 + 跨端常量收敛）

- **问题**：
  - 项目缺乏接力规范，新对话/新 agent 难以快速理解架构与已有约束，存在重复犯错风险。
  - `USER_AGENT` 字面量在 3 个服务里各自定义，违反「单一来源」原则。
- **措施**：
  - 新增 `AGENTS.md`（项目根，Cursor 自动注入）：必读三件套清单、工作纪律、命令速查、边界。
  - 新增 `docs/ARCHITECTURE.md`：分层流水线、`applyRules` 次序、`decideAiUse` 触发表、数据契约、扩展点速查、跨文件同步清单。
  - 新增 `docs/DECISIONS.md`：把前 3 轮决策固化为 D-001 ~ D-010；本轮再追加 D-011 ~ D-012。
  - 简化 `docs/upgrade-plans/README.md` 为流程纪律；`CURRENT.md` 模板化为「上轮摘要 + 下轮占位」。
  - 删除 `docs/upgrade-plans/ARCHITECTURE.md`（迁移到 `docs/ARCHITECTURE.md`，避免双份）。
  - 代码层：把 `User-Agent` 字面量抽到 `packages/shared/src/url-utils.ts#DEFAULT_USER_AGENT`，三处 service 改为 import；记入 D-011。
- **新增决策**：D-011（跨端常量唯一来源）、D-012（文档驱动迭代）。
- **涉及文件**：
  - `AGENTS.md`（新）
  - `docs/ARCHITECTURE.md`（新，替代 `upgrade-plans/ARCHITECTURE.md`）
  - `docs/DECISIONS.md`（新）
  - `docs/upgrade-plans/{README,CURRENT}.md`（重写）
  - `packages/shared/src/url-utils.ts`
  - `apps/api/src/probe/{http-probe,browser-probe}.service.ts`
  - `apps/api/src/ai/ai.service.ts`

---

## 下轮占位（开始下一轮迭代前清空本节，写入新计划；合并后再次精简为「上轮摘要」并把要点追加进 DECISIONS.md）

```
### 计划题目（YYYY-MM-DD · Round N · 简短主题）

- 问题：
- 目标：
- 拟措施：
- 风险/不做的事：
```
