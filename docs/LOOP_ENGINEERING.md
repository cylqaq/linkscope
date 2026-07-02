# LinkScope · Loop Engineering 指南

> 本文档指导如何在 LinkScope 项目中实践 Loop Engineering（循环工程），实现自动化迭代开发。

## 1. Loop Engineering 概述

Loop Engineering 是 2026 年 AI Agent 开发的核心范式，核心思想是：

**从"单次交互"演进为"自动迭代循环"**，让 Agent 能够自主决定"何时跑、跑几趟、跑到什么算完"。

### 1.1 核心原则

1. **验证优先**：禁止模型自评，使用测试/Linter/类型检查作为终止条件
2. **持久化上下文**：将配置落盘，防止跨会话失忆
3. **状态隔离**：利用 Git Worktrees 实现并行实验
4. **可观测性**：在磁盘记录进度，便于调试和恢复

### 1.2 六大积木

| 积木 | Cursor 实现 | 配置位置 |
|------|-------------|----------|
| **Automations** | `/loop`、Cursor Automations | Chat、cursor.com |
| **Worktrees** | `git worktree` 隔离并行 | 终端 / SDK |
| **Skills** | 项目知识与流程外置 | `.cursor/skills/` |
| **Connectors** | MCP 接 GitHub、Slack 等 | `.cursor/mcp.json` |
| **Sub-agents** | Task 子代理分工 | Agent 模式 |
| **State** | 跨运行记忆 | `AGENTS.md`、状态文件 |

## 2. 项目配置

### 2.1 目录结构

```
linkscope/
├── .cursor/
│   ├── rules/                    # 静态规则
│   │   └── linkscope-rules.md    # 项目特定规则
│   ├── skills/                   # 动态技能
│   │   └── linkscope-detection/
│   │       └── SKILL.md          # 检测领域知识
│   ├── hooks.json                # 安全门禁
│   └── mcp.json                  # MCP 服务器配置
├── AGENTS.md                     # Agent 接力指南
├── docs/
│   ├── ARCHITECTURE.md           # 架构文档
│   ├── DECISIONS.md              # 决策记录
│   └── upgrade-plans/
│       └── CURRENT.md            # 当前迭代计划
└── scripts/
    ├── verify.sh                 # 验证脚本
    └── loop-state.json           # 循环状态
```

### 2.2 创建 Skills

创建 `.cursor/skills/linkscope-detection/SKILL.md`：

```markdown
# LinkScope 检测技能

## 概述
链接有效性检测和内容下架判断的领域知识。

## 核心概念
1. **三层检测**：L1 HTTP → L2 浏览器 → L3 AI
2. **状态模型**：accessible / dead_link / review_required
3. **平台适配**：20+ 国内平台的特定模式

## 检测流程
1. URL 规范化和去重
2. HTTP 探测（HEAD → GET 回退）
3. 浏览器探测（按需）
4. AI 复核（按需）
5. 结果融合

## 常见问题
- **反爬虫 404**：使用浏览器二次验证
- **SPA 页面**：增加等待时间，监听网络请求
- **登录墙**：标记为 review_required

## 代码位置
- HTTP 探测：`apps/api/src/probe/http-probe.service.ts`
- 浏览器探测：`apps/api/src/probe/browser-probe.service.ts`
- 分类服务：`apps/api/src/classify/classify.service.ts`
```

### 2.3 配置 Hooks

创建 `.cursor/hooks.json`：

```json
{
  "hooks": {
    "beforeAgentStart": [
      {
        "name": "read-documentation",
        "script": "scripts/before-start.sh",
        "description": "读取项目文档，确保理解上下文"
      }
    ],
    "afterFileEdit": [
      {
        "name": "typecheck",
        "script": "scripts/typecheck.sh",
        "description": "编辑后自动类型检查"
      }
    ],
    "beforeCommit": [
      {
        "name": "verify",
        "script": "scripts/verify.sh",
        "description": "提交前验证"
      }
    ]
  }
}
```

### 2.4 创建验证脚本

创建 `scripts/verify.sh`：

```bash
#!/bin/bash
set -e

echo "=== LinkScope 验证脚本 ==="

# 1. 类型检查
echo "1. 运行类型检查..."
pnpm --filter @linkscope/shared build
pnpm --filter @linkscope/api typecheck
pnpm --filter @linkscope/web typecheck

# 2. Lint 检查
echo "2. 运行 Lint 检查..."
pnpm lint

# 3. 单元测试
echo "3. 运行单元测试..."
pnpm test

# 4. 检查死代码
echo "4. 检查死代码..."
# 可以使用 knip 或其他工具

echo "=== 验证完成 ==="
```

## 3. 循环工程实践

### 3.1 使用 /loop 命令

在 Cursor Chat 中使用 `/loop` 命令：

```
/loop 运行验证脚本，修复所有类型错误，直到所有测试通过
```

### 3.2 循环状态管理

创建 `scripts/loop-state.json`：

```json
{
  "currentIteration": 0,
  "maxIterations": 10,
  "goal": "修复所有类型错误",
  "status": "running",
  "history": [
    {
      "iteration": 1,
      "timestamp": "2026-07-01T10:00:00Z",
      "action": "修复了 3 个类型错误",
      "result": "success"
    }
  ]
}
```

### 3.3 验证优先模式

```typescript
// 在 Agent 提示中强调验证
const AGENT_PROMPT = `
你是一个专业的代码修复 Agent。

**重要规则**：
1. 不要自己判断代码是否正确
2. 每次修改后必须运行验证脚本
3. 只有验证脚本通过才算完成
4. 如果验证失败，分析错误并继续修复

验证命令：./scripts/verify.sh
`
```

## 4. 最佳实践

### 4.1 渐进式采用

**第 1 层：基础循环**
- 使用 `/loop` + 状态文件 + 验收脚本
- 适合个人开发者

**第 2 层：自动化**
- 使用 Cursor Automations
- 定时运行验证和修复
- 适合小团队

**第 3 层：CI/CD 集成**
- 使用 `@cursor/sdk` 和 CLI
- 集成到 GitHub Actions
- 适合大团队

### 4.2 状态文件设计

```markdown
# loop-state.md

## 当前状态
- 目标：优化截图等待策略
- 迭代次数：3/10
- 状态：进行中

## 历史记录
### 迭代 1 (2026-07-01)
- 修改：增加动态等待逻辑
- 结果：类型检查通过，但测试失败

### 迭代 2 (2026-07-01)
- 修改：修复测试中的断言
- 结果：所有测试通过

### 迭代 3 (2026-07-01)
- 修改：优化等待算法
- 结果：待验证
```

### 4.3 错误处理

```typescript
// 在循环中处理错误
for (let i = 0; i < maxIterations; i++) {
  try {
    await runVerification()
    console.log('验证通过！')
    break
  } catch (error) {
    console.log(`迭代 ${i + 1} 失败: ${error.message}`)
    await fixIssue(error)
    
    if (i === maxIterations - 1) {
      console.log('达到最大迭代次数，停止循环')
      // 记录状态，便于下次继续
      await saveState({ lastError: error.message })
    }
  }
}
```

## 5. 案例：优化截图等待策略

### 5.1 目标

将固定 3 秒等待改为动态等待，根据页面特征调整。

### 5.2 循环流程

```
迭代 1：分析当前代码 → 识别问题 → 制定方案
迭代 2：实现动态等待逻辑 → 运行类型检查
迭代 3：编写测试 → 运行测试
迭代 4：优化算法 → 性能测试
迭代 5：更新文档 → 提交代码
```

### 5.3 验证脚本

```bash
#!/bin/bash
# scripts/verify-screenshot.sh

echo "验证截图等待策略..."

# 1. 类型检查
pnpm --filter @linkscope/api typecheck

# 2. 单元测试
pnpm --filter @linkscope/api test -- --grep "screenshot"

# 3. 集成测试
pnpm test:integration -- --grep "screenshot"

# 4. 性能测试
node scripts/performance-test.js

echo "验证完成"
```

## 6. 高级技巧

### 6.1 并行循环

使用 Git Worktrees 实现并行实验：

```bash
# 创建 worktree
git worktree add ../linkscope-experiment-1 -b experiment/dynamic-wait

# 在 worktree 中运行循环
cd ../linkscope-experiment-1
/cursor:agent 运行循环...

# 合并结果
cd ../linkscope
git merge experiment/dynamic-wait
```

### 6.2 子代理分工

```typescript
// 使用 Task 工具分工
const exploreAgent = Task({
  description: '探索代码结构',
  prompt: '分析 screenshot 相关代码',
  subagent_type: 'explore',
})

const implementAgent = Task({
  description: '实现新功能',
  prompt: '实现动态等待逻辑',
  subagent_type: 'generalPurpose',
})

const testAgent = Task({
  description: '运行测试',
  prompt: '运行并修复测试',
  subagent_type: 'shell',
})
```

### 6.3 状态恢复

```typescript
// 从状态文件恢复
const state = await readState('loop-state.json')

if (state.status === 'paused') {
  console.log(`从迭代 ${state.currentIteration} 继续`)
  console.log(`上次错误: ${state.lastError}`)
  
  // 继续循环
  await continueLoop(state)
}
```

## 7. 监控与调试

### 7.1 循环日志

```json
{
  "iterations": [
    {
      "id": 1,
      "start": "2026-07-01T10:00:00Z",
      "end": "2026-07-01T10:05:00Z",
      "actions": ["修改 browser-probe.service.ts"],
      "result": "success",
      "metrics": {
        "filesChanged": 1,
        "testsPassed": 15,
        "typeErrors": 0
      }
    }
  ]
}
```

### 7.2 可视化进度

```markdown
# 循环进度

| 迭代 | 状态 | 耗时 | 修改文件 | 测试结果 |
|------|------|------|----------|----------|
| 1 | ✅ | 5m | 1 | 15/15 |
| 2 | ✅ | 3m | 2 | 15/15 |
| 3 | 🔄 | - | 0 | 进行中 |
```

## 8. 参考资源

- [Cursor Agent 最佳实践](https://baoyu.io/translations/2026/01/12/cursor-agent-best-practices)
- [深入理解 Loop Engineering](https://juejin.cn/post/7654519145633087539)
- [Cursor 官方文档](https://docs.cursor.com)
- [Harness 工程指南](https://yeasy.gitbook.io/harness_engineering_guide)

## 9. 文档规范与边界

### 9.1 文档更新规范

**必须更新文档的场景**：
1. 新增验证脚本
2. 修改循环流程
3. 新增 Skills 或 Hooks
4. 修改状态管理逻辑
5. 修改监控指标

**更新流程**：
1. 修改代码前先读 `DECISIONS.md` 相关条目
2. 修改后更新本文档对应章节
3. 在 `DECISIONS.md` 追加新条目（D-NNN）
4. 必要时更新 `ARCHITECTURE.md`

### 9.2 边界限制（NEVER）

1. **不跳过验证**：所有循环必须以验证脚本通过为终止条件
2. **不手动判断**：禁止模型自评，必须使用机械化验证
3. **不丢失状态**：所有迭代进度必须持久化到状态文件
4. **不并行修改同一文件**：使用 Git Worktrees 隔离并行实验

### 9.3 验证脚本规范

**必须验证的项目**：
1. 类型检查（typecheck）
2. 代码风格（lint）
3. 单元测试（test）
4. 死代码检查（可选）

**验证脚本退出码**：
- 0：验证通过
- 1：验证失败
- 2：验证脚本本身错误

**验证脚本输出规范**：
```
=== LinkScope 验证脚本 ===
1. 运行类型检查... ✓
2. 运行 Lint 检查... ✓
3. 运行单元测试... ✓
4. 检查死代码... ✓
=== 验证完成 ===
```

### 9.4 状态文件规范

**必须包含的字段**：
```json
{
  "currentIteration": 0,
  "maxIterations": 10,
  "goal": "目标描述",
  "status": "running|paused|completed|failed",
  "history": [],
  "lastError": null,
  "lastUpdated": "ISO 8601 时间戳"
}
```

**状态值说明**：
- `running`：循环进行中
- `paused`：循环暂停（可恢复）
- `completed`：循环完成
- `failed`：循环失败（达到最大迭代次数）

### 9.5 Skills 设计规范

**必须包含的内容**：
1. 概述：技能的目的和范围
2. 核心概念：关键术语和概念
3. 流程：详细的操作步骤
4. 常见问题：已知问题和解决方案
5. 代码位置：相关代码的文件路径

**命名规范**：
- 目录名：`kebab-case`（如 `linkscope-detection`）
- 文件名：`SKILL.md`（固定）

### 9.6 Hooks 配置规范

**支持的钩子类型**：
- `beforeAgentStart`：Agent 启动前
- `afterFileEdit`：文件编辑后
- `beforeCommit`：提交前
- `afterTest`：测试后

**钩子脚本规范**：
- 必须是可执行文件
- 必须返回退出码（0=成功，非0=失败）
- 必须输出有意义的错误信息

### 9.7 循环流程规范

**标准循环流程**：
```
1. 读取状态文件
2. 检查是否达到最大迭代次数
3. 执行修改
4. 运行验证脚本
5. 验证通过？
   ├─ 是 → 更新状态为 completed
   └─ 否 → 记录错误，继续循环
6. 更新状态文件
```

**循环终止条件**：
1. 验证脚本通过（成功）
2. 达到最大迭代次数（失败）
3. 手动暂停（暂停）
4. 发生不可恢复错误（失败）

### 9.8 监控与告警规范

**必须监控的指标**：
1. 循环成功率（目标：≥ 80%）
2. 平均迭代次数（目标：≤ 5）
3. 验证脚本执行时间（目标：≤ 60秒）
4. 状态文件更新频率

**告警阈值**：
- 循环成功率 < 50%：立即告警
- 平均迭代次数 > 10：警告
- 验证脚本执行时间 > 120秒：警告
- 状态文件未更新 > 24小时：警告

### 9.9 错误处理规范

**错误分类**：
1. **可恢复错误**：类型错误、Lint 错误、测试失败
2. **不可恢复错误**：磁盘空间不足、权限问题
3. **验证脚本错误**：脚本本身执行失败

**错误处理流程**：
```
发生错误
    ↓
记录错误到状态文件
    ↓
判断错误类型
    ├─ 可恢复 → 分析错误，继续循环
    ├─ 不可恢复 → 暂停循环，等待人工干预
    └─ 验证脚本错误 → 修复脚本，重新运行
```

### 9.10 版本控制规范

**必须纳入版本控制的文件**：
- `.cursor/skills/` 目录
- `.cursor/rules/` 目录
- `.cursor/hooks.json`
- `scripts/verify.sh`
- `docs/LOOP_ENGINEERING.md`

**不得纳入版本控制的文件**：
- `scripts/loop-state.json`（运行时状态）
- `*.log`（日志文件）
- `node_modules/`（依赖）

### 9.11 测试规范

**必须测试的场景**：
1. 验证脚本正常执行
2. 验证脚本失败处理
3. 状态文件读写
4. 循环流程完整性

**测试覆盖率要求**：
- 验证脚本：100% 覆盖
- 状态管理：≥ 90%
- 循环流程：≥ 80%

### 9.12 性能规范

**性能基准**：
- 验证脚本执行时间：≤ 60 秒
- 状态文件读写延迟：≤ 100ms
- 循环启动时间：≤ 5 秒

**优化策略**：
1. 并行执行验证任务
2. 缓存验证结果
3. 增量验证（只验证修改的部分）
4. 异步更新状态文件
