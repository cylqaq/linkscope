# 当前迭代窗口

> 单窗口约定（D-008 / D-012）：合并后只保留「上轮摘要」一段；下一轮开始前清空摘要正文，把要点同步追加到 `docs/DECISIONS.md`。
>
> 模板见文末「下轮占位」。

## 上轮摘要（2026-07-02 · Round 16 · 功能孤岛清理 + 逻辑 Bug 修复）

- **问题**：全局审查发现多处功能孤岛（注册但从未使用的模块）、逻辑 Bug 和代码不一致问题。BrowserPoolService（289 行）和 MetricsService（220 行）从未被实际调用；SmartWaitService 条件顺序错误导致高负载等待逻辑失效；AiService 冗余代码；export.service.ts 与 ResultCard.tsx 的 REASON_LABEL 不一致。
- **措施**：✅ 删除 BrowserPoolService 和 MetricsService；✅ 修复 SmartWaitService 条件顺序 bug；✅ 修复 AiService 冗余 tool_choice；✅ 清理未使用依赖（class-transformer, class-validator, p-limit）；✅ 同步 REASON_LABEL；✅ 清理 .env.example 未使用变量；✅ 简化 HealthController。
- **决策**：`DECISIONS.md` **D-042**。

---

## 下轮占位

### 验收标准
1. ⏳ 测试覆盖率达到目标（单元测试≥80%，集成测试≥70%，端到端测试≥60%）
2. ⏳ 性能优化：探测延迟、并发能力
3. ⏳ MCP Server 集成完善（当前 determineStatus 与 ClassifyService 逻辑重复）
