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
  AI_DEVELOPMENT.md       AI 开发指南
  MCP_INTEGRATION.md      MCP 集成指南
  LOOP_ENGINEERING.md     Loop Engineering 指南
  DOCUMENTATION_STANDARDS.md 文档规范与边界
  upgrade-plans/
    README.md             流程
    CURRENT.md            单窗口（上轮摘要 + 下轮占位）
.cursor/
  skills/                 动态技能（领域知识）
  rules/                  静态规则
  hooks.json              安全门禁
  mcp.json                MCP 服务器配置
scripts/
  verify.sh               验证脚本
  loop-state.json         循环状态
```

## 新增文档指南

### AI 开发（`docs/AI_DEVELOPMENT.md`）
- 模型集成：DeepSeek / OpenAI 切换
- 提示词工程：版本管理、系统提示词结构
- 工具调用：fetch_url / fetch_url_rendered
- 结果融合：规则 + AI 加权策略

### MCP 集成（`docs/MCP_INTEGRATION.md`）
- 作为 MCP Server：暴露检测能力
- 作为 MCP Client：接入外部工具
- 传输协议：stdio / Streamable HTTP
- 工具列表：detect_link_status / batch_detect

### Loop Engineering（`docs/LOOP_ENGINEERING.md`）
- 循环工程范式：从单次交互到自动迭代
- 六大积木：Automations / Worktrees / Skills / Connectors / Sub-agents / State
- 验证流程：verify.sh + 类型检查 + 测试
- 状态管理：loop-state.json

### 文档规范（`docs/DOCUMENTATION_STANDARDS.md`）
- 文档分类：技术文档、决策记录、迭代计划
- 更新规范：必须更新场景、更新流程、版本控制
- 边界限制：禁止行为、必须遵循规范
- 质量检查：检查清单、质量指标

## 循环工程快速开始

1. **配置 Skills**
```bash
mkdir -p .cursor/skills/linkscope-detection
# 创建 SKILL.md（见 LOOP_ENGINEERING.md）
```

2. **配置 Hooks**
```bash
# 创建 .cursor/hooks.json（见 LOOP_ENGINEERING.md）
```

3. **创建验证脚本**
```bash
chmod +x scripts/verify.sh
```

4. **运行循环**
```
/loop 运行验证脚本，修复所有类型错误，直到所有测试通过
```

## MCP 集成快速开始

1. **安装依赖**
```bash
pnpm add @modelcontextprotocol/sdk zod
```

2. **配置 MCP Server**
```json
// .cursor/mcp.json
{
  "mcpServers": {
    "linkscope": {
      "command": "node",
      "args": ["dist/mcp/mcp-server.js"]
    }
  }
}
```

3. **使用工具**
```
在 Cursor 中调用 detect_link_status 工具检测链接
```
