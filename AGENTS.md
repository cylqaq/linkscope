# LinkScope · Agent 接力指南

> 任何新对话/新 agent 接手本项目，**第一步先读这份**。本文件承担：
> 1) 让你迅速理解项目；2) 指给你必读资料；3) 框定不能跨过的边界。
> Cursor 会自动把根目录的 `AGENTS.md` 注入上下文。

## 是什么

LinkScope 是「批量链接有效性检测」服务：用户粘贴/上传一批 URL，系统判定每条是否仍可被普通用户访问，并给出可解释证据（HTTP 信号 / 浏览器渲染信号 / AI 复核结论）。

重点适配：抖音、哔哩哔哩、小红书、微博、快手、B 站等国内主流短视频与社交站点（见 `packages/shared/src/platforms.ts`）。

## 必读三件套（按顺序）

1. **`docs/ARCHITECTURE.md`** — 分层探测流水线、关键数据契约、扩展点。**改判定逻辑前必读**。
2. **`docs/DECISIONS.md`** — 累积的判定原则（仅追加，每条标轮次/日期）。新决策不要破坏旧决策；如必须推翻，需显式追加"超越条目"并保留历史。
3. **`docs/upgrade-plans/CURRENT.md`** — 单窗口迭代计划（上轮摘要 + 下轮占位）。**每轮开始前先读、合并后立即清理**。

## 工作纪律（必须遵守）

- 改 L1/L2/L3 任何一层之前：先看 `ARCHITECTURE.md` 的「分层流水线」与「数据契约」，再看 `DECISIONS.md` 中相关 D 编号原则。
- 每一轮迭代收尾必做：
  1. 精简 `docs/upgrade-plans/CURRENT.md` 为单段「上轮摘要」。
  2. 把可长期复用的判断/约束以新 `D-NNN` 条目追加到 `docs/DECISIONS.md`。
  3. 必要时小幅修订 `docs/ARCHITECTURE.md`（如新增分层错误码/新工具）。
- 不要长期保留死代码、注释掉的旧实现、未启用的 `ReasonCode` 字面量。**要么用上要么删**。
- 不写让用户误解的失败默认值（如把 AI 失败固定写成"AI 判定失败"落库 — 见 D-004）。
- 凡是用户能看到的字段，都必须能溯源到 `Evidence` 中的某项或规则分支（D-010）。

## 命令速查

```powershell
# Windows / PowerShell；macOS/Linux 一样能跑
pnpm --filter @linkscope/shared build      # 共享包出 dist；改 types 后必须先跑
pnpm --filter @linkscope/api typecheck
pnpm --filter @linkscope/web typecheck

pnpm --filter @linkscope/shared dev        # tsc --watch
pnpm --filter @linkscope/api dev           # NestJS watch on :3001
pnpm --filter @linkscope/web dev           # Next.js on :3000

pnpm db:push                               # Prisma schema → DB
```

## 边界（NEVER）

- 不要修改 git config / 不擅自 push --force / 不擅自启用代理。
- 不要把 `dist / .next / screenshots / uploads / *.tsbuildinfo` 提交进 git。
- 不要在 `packages/shared/src` 或 `apps/api/src` 里产生 `.js / .d.ts`（D-009：tsconfig 的 `outDir/rootDir` 已显式设置；如果再次出现立即清理）。
- 不要把追踪参数（`previous_page / share_token / spm / sec_uid` 等）显示给用户（D-003）。

## 目录速览

```
apps/
  api/   NestJS · L1+L2+L3 探测、Bull 队列、Prisma
  web/   Next.js 14 App Router · 极简聊天 UI
packages/
  shared/ 跨端类型与工具（types.ts / platforms.ts / url-utils.ts）
docs/
  ARCHITECTURE.md         长期：分层与契约
  DECISIONS.md            长期：累积原则（仅追加）
  upgrade-plans/
    README.md             流程
    CURRENT.md            单窗口（上轮摘要 + 下轮占位）
```
