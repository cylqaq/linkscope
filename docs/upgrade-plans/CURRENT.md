# 当前迭代窗口

> 单窗口约定（D-008 / D-012）：合并后只保留「上轮摘要」一段；下一轮开始前清空摘要正文，把要点同步追加到 `docs/DECISIONS.md`。
>
> 模板见文末「下轮占位」。

## 上轮摘要（2026-07-02 · Round 16 · 功能孤岛清理 + 逻辑 Bug 修复 + 文档一致性）

- **问题**：全局审查（4 个并行分析 agent）发现：BrowserPoolService（289 行）和 MetricsService（220 行）从未被核心流程调用；SmartWaitService 条件顺序 bug 导致高负载等待逻辑失效；AiService 冗余代码；REASON_LABEL/STATUS_LABEL 前后端不一致；文档中多处描述与代码不符（阈值、版本号、不存在的功能）；前端有未使用依赖。
- **措施**：✅ 删除 BrowserPoolService 和 MetricsService；✅ 修复 SmartWaitService 条件顺序 bug；✅ 修复 AiService 冗余 tool_choice；✅ 清理未使用依赖（class-transformer, class-validator, p-limit, clsx, lucide-react, swr）；✅ 同步 REASON_LABEL 和 STATUS_LABEL；✅ 清理 .env.example 未使用变量 + 补充 OPENAI_MODEL；✅ 简化 HealthController；✅ 修复 D-002 阈值描述；✅ 更新 Prompt 版本号；✅ 标注 AI_DEVELOPMENT.md 中未实现的功能；✅ 修正 MCP_INTEGRATION.md 配置示例。
- **决策**：`DECISIONS.md` **D-042**、**D-043**。

---

## 下轮占位

### 验收标准
1. ⏳ 测试覆盖率达到目标（单元测试≥80%，集成测试≥70%，端到端测试≥60%）
2. ⏳ MCP Server 逻辑统一（当前 determineStatus 与 ClassifyService 逻辑重复，需直接调用 ClassifyService）
3. ⏳ 前端类型安全（当前全部使用 `any`，应导入 `@linkscope/shared` 类型）
