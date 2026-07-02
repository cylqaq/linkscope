# 升级流程

> 本目录只承载**当前一轮**的迭代窗口。长期约束写到 `docs/DECISIONS.md`，长期架构写到 `docs/ARCHITECTURE.md`。

## 文件

| 文件 | 用途 |
|---|---|
| `CURRENT.md` | 单窗口：「上轮摘要」+「下轮占位」。**合并后立即精简**，把可长期复用的判断追加进 `docs/DECISIONS.md`。 |

## 一轮迭代的标准动作

1. **开始前**：读 `AGENTS.md` → `docs/ARCHITECTURE.md` → `docs/DECISIONS.md` → `CURRENT.md`。
2. **写代码**：每动一类逻辑，回看相关 `D-NNN` 条目；偏离要么不做，要么追加新决策。
3. **收尾**：
   - `CURRENT.md` 中只保留**单段「上轮摘要」**（含问题/措施/涉及文件/新决策编号）；
   - 在 `docs/DECISIONS.md` 末尾追加 `D-NNN` 条目；
   - 必要时小幅修订 `docs/ARCHITECTURE.md`；
   - 删除任何死代码、注释掉的旧实现。
4. **提交**：commit message 简述本轮主题（不必复述细节，文档已写）。
