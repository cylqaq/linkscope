# LinkScope · MCP 集成指南

> 本文档指导如何将 LinkScope 与 MCP（Model Context Protocol）协议集成，实现工具生态扩展。

## 1. MCP 协议概述

MCP 是 AI Agent 连接外部工具的标准协议，2026 年已成为事实标准。LinkScope 可以：

1. **作为 MCP Server**：暴露检测能力给其他 AI Agent
2. **作为 MCP Client**：接入外部工具增强检测能力

### 1.1 核心概念

- **Tools**：可调用的函数（如 `detect_link_status`）
- **Resources**：只读数据源（如 `platform_configs`）
- **Prompts**：提示词模板

### 1.2 2026-07-28 规范更新

- **无状态核心**：移除会话依赖，支持水平扩展
- **Streamable HTTP**：新的传输协议，替代 SSE
- **Tasks 扩展**：支持长时间运行的任务

## 2. 作为 MCP Server

### 2.1 安装依赖

```bash
pnpm add @modelcontextprotocol/sdk zod
```

### 2.2 MCP Server 实现（NestJS 集成）

MCP 服务器作为 NestJS 服务实现，通过依赖注入接入实际检测服务（D-033）：

```typescript
// apps/api/src/mcp/mcp-server.ts
@Injectable()
export class LinkScopeMcpServer {
  private readonly logger = new Logger(LinkScopeMcpServer.name)
  private server: Server

  constructor(
    private readonly tasksService: TasksService,
    private readonly exportService: ExportService,
    private readonly httpProbeService: HttpProbeService,
    private readonly browserProbeService: BrowserProbeService,
    private readonly screenHintsService: ScreenHintsService,
  ) {
    this.server = new Server({ name: 'linkscope', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } })
    this.setupHandlers()
  }

  // 核心检测逻辑：L1 HTTP 探测 + 可选 L2 浏览器探测
  private async detectLink(url: string, options?: { skipBrowser?: boolean; skipAi?: boolean; platform?: string }) {
    const httpResult = await this.httpProbeService.probe(url)
    let browserResult = null

    if (!options?.skipBrowser && this.httpProbeService.shouldTriggerBrowserFallback(url, httpResult)) {
      browserResult = await this.browserProbeService.probe(url, 'mcp-' + Date.now(), { skipScreenshot: true })
    }

    return { url, platform: detectPlatform(url)?.id || 'generic', finalStatus: this.determineStatus(httpResult, browserResult), ... }
  }
}

// apps/api/src/mcp/mcp.module.ts
@Module({
  imports: [TasksModule, ExportModule, ProbeModule, ScreenHintsModule],
  providers: [LinkScopeMcpServer],
  exports: [LinkScopeMcpServer],
})
export class McpModule {}
```

**关键变更**：
- MCP 服务器标记为 `@Injectable()`，通过构造函数注入实际服务
- `detectLink()` 执行完整的 L1 + L2 探测流水线
- `determineStatus()` 基于 HTTP 状态码、浏览器 DOM 信号、网络错误码进行判定
- 新增 `McpModule` 注册到 `AppModule`，不再支持独立启动

### 2.3 配置 Cursor 集成

在 `.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "linkscope": {
      "command": "node",
      "args": ["dist/mcp/mcp-server.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "REDIS_HOST": "localhost"
      }
    }
  }
}
```

### 2.4 暴露的工具列表

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `detect_link_status` | 检测链接状态 | `url`, `options?` |
| `batch_detect` | 批量检测 | `urls[]`, `options?` |
| `get_task_results` | 获取任务结果 | `taskId` |
| `export_results` | 导出结果 | `taskId`, `format` |

### 2.5 暴露的资源列表

| 资源名 | URI | 描述 |
|--------|-----|------|
| `platform_configs` | `linkscope://platforms` | 平台配置列表 |
| `detection_history` | `linkscope://history` | 检测历史 |
| `screen_hints` | `linkscope://hints` | 屏幕提示规则 |

## 3. 作为 MCP Client

### 3.1 接入外部工具

在 Cursor Settings → MCP 中配置外部服务器：

```json
{
  "mcpServers": {
    "ocr-service": {
      "command": "npx",
      "args": ["@anthropic/mcp-ocr"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-xxx"
      }
    },
    "web-scraper": {
      "command": "python",
      "args": ["-m", "mcp_web_scraper"],
      "transport": "stdio"
    }
  }
}
```

### 3.2 可用的外部工具

#### 截图 OCR
- **@anthropic/mcp-ocr**：截图文字识别
- **用途**：识别截图中的"已删除"、"不存在"等文字

#### 内容分析
- **@anthropic/mcp-content-analyzer**：内容语义分析
- **用途**：判断内容是否为错误页面

#### 网页抓取
- **mcp_web_scraper**：高级网页抓取
- **用途**：绕过反爬虫获取页面内容

### 3.3 在代码中调用外部工具

```typescript
// 通过 MCP 客户端调用外部工具
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js'

const client = new McpClient({
  name: 'linkscope-client',
  version: '1.0.0',
})

// 连接到 OCR 服务
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['@anthropic/mcp-ocr'],
})
await client.connect(transport)

// 调用 OCR 工具
const result = await client.callTool({
  name: 'ocr_screenshot',
  arguments: { imagePath: '/path/to/screenshot.jpg' },
})
```

## 4. 高级集成

### 4.1 自定义传输层

```typescript
// Streamable HTTP 传输（2026-07-28 规范）
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

const transport = new StreamableHTTPServerTransport({
  endpoint: '/mcp',
  // 无状态模式
  stateless: true,
})
```

### 4.2 工具权限控制

```typescript
server.tool(
  'detect_link_status',
  '检测链接状态',
  { ... },
  async (params) => {
    // 检查权限
    if (!hasPermission(params.url)) {
      throw new Error('无权访问该URL')
    }
    // 执行检测
    return await detectLink(params.url)
  }
)
```

### 4.3 工具调用审计

```typescript
// 记录所有工具调用
server.on('toolCall', async (call) => {
  await auditLog.record({
    tool: call.name,
    params: call.arguments,
    timestamp: new Date(),
    user: call.context?.user,
  })
})
```

## 5. 部署与运维

### 5.1 本地部署

MCP 服务器作为 NestJS 应用的一部分启动，不再支持独立运行：

```bash
# 启动 API 服务（包含 MCP 服务器）
pnpm --filter @linkscope/api dev

# 或构建后启动
pnpm --filter @linkscope/api build
pnpm --filter @linkscope/api start
```

**注意**：`mcp-server.ts` 中的 `require.main === module` 入口仅输出错误提示，引导用户通过 NestJS 启动。

### 5.2 远程部署

远程部署使用 Streamable HTTP 传输（2026-07-28 规范），需在 NestJS 中配置传输层：

```typescript
// 未来扩展：在 McpModule 中配置 StreamableHTTPServerTransport
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

const transport = new StreamableHTTPServerTransport({
  endpoint: '/mcp',
  stateless: true, // 无状态模式，支持水平扩展
})
```

当前版本仅支持 stdio 传输，Streamable HTTP 将在后续版本中实现。

### 5.3 健康检查

```typescript
// 添加健康检查端点
server.tool('health_check', '检查服务状态', {}, async () => {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'healthy',
        version: '1.0.0',
        uptime: process.uptime(),
      }),
    }],
  }
})
```

## 6. 安全考虑

### 6.1 认证与授权

```typescript
// API Key 认证
const apiKey = process.env.MCP_API_KEY
if (apiKey) {
  server.use(async (ctx, next) => {
    if (ctx.request.headers['authorization'] !== `Bearer ${apiKey}`) {
      throw new Error('Unauthorized')
    }
    return next()
  })
}
```

### 6.2 输入验证

```typescript
// 使用 Zod 验证输入
const urlSchema = z.string().url().refine(
  (url) => !isPrivateIP(new URL(url).hostname),
  { message: '禁止访问内网地址' }
)
```

### 6.3 速率限制

```typescript
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 100, // 每分钟最多 100 次请求
})
```

## 7. 测试

### 7.1 单元测试

```typescript
describe('MCP Server', () => {
  it('should list available tools', async () => {
    const tools = await client.listTools()
    expect(tools).toContainEqual(
      expect.objectContaining({ name: 'detect_link_status' })
    )
  })

  it('should detect dead link', async () => {
    const result = await client.callTool({
      name: 'detect_link_status',
      arguments: { url: 'https://example.com/deleted-page' },
    })
    expect(JSON.parse(result.content[0].text).finalStatus).toBe('dead_link')
  })
})
```

### 7.2 集成测试

```bash
# 使用 MCP Inspector 测试
npx @modelcontextprotocol/inspector node dist/mcp/mcp-server.js
```

## 8. 最佳实践

### 8.1 工具设计原则

1. **单一职责**：每个工具只做一件事
2. **幂等性**：相同输入产生相同输出
3. **可组合性**：工具可以组合使用
4. **错误处理**：返回清晰的错误信息

### 8.2 性能优化

1. **缓存**：缓存频繁查询的结果
2. **批量处理**：支持批量操作减少调用次数
3. **异步执行**：长时间操作使用 Tasks 扩展

### 8.3 监控与告警

1. **调用统计**：记录工具调用次数和延迟
2. **错误监控**：监控工具调用失败率
3. **资源使用**：监控内存和 CPU 使用

## 9. 参考资源

- [MCP 官方文档](https://modelcontextprotocol.io)
- [MCP SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [2026-07-28 规范](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)

## 10. 文档规范与边界

### 10.1 文档更新规范

**必须更新文档的场景**：
1. 新增 MCP 工具
2. 修改工具参数
3. 新增资源类型
4. 修改传输协议
5. 修改安全策略

**更新流程**：
1. 修改代码前先读 `DECISIONS.md` 相关条目
2. 修改后更新本文档对应章节
3. 在 `DECISIONS.md` 追加新条目（D-NNN）
4. 必要时更新 `ARCHITECTURE.md`

### 10.2 边界限制（NEVER）

1. **不暴露敏感数据**：不得通过 MCP 暴露 API Key、密码等
2. **不绕过权限控制**：所有工具调用必须经过权限验证
3. **不跳过输入验证**：所有参数必须使用 Zod 验证
4. **不记录完整请求**：审计日志必须脱敏处理

### 10.3 工具设计规范

**必须遵循的原则**：
1. **单一职责**：每个工具只做一件事
2. **幂等性**：相同输入产生相同输出
3. **可组合性**：工具可以组合使用
4. **错误处理**：返回清晰的错误信息

**工具命名规范**：
- 使用 snake_case 命名
- 动词开头：`detect_`、`get_`、`export_`
- 名词结尾：`_status`、`_results`、`_config`

### 10.4 安全规范

**必须实施的安全措施**：
1. **输入验证**：所有参数使用 Zod 验证
2. **权限控制**：基于角色的访问控制
3. **速率限制**：防止滥用
4. **审计日志**：记录所有工具调用

**禁止访问的资源**：
- 内网 IP 地址
- 本地文件系统
- 数据库直接访问
- 环境变量

### 10.5 性能规范

**性能基准**：
- 工具调用延迟：≤ 5 秒
- 资源加载延迟：≤ 2 秒
- 并发处理能力：≥ 50 请求/分钟

**优化策略**：
1. 缓存频繁查询的结果
2. 批量处理减少调用次数
3. 异步执行长时间操作
4. 连接池管理

### 10.6 测试规范

**必须测试的场景**：
1. 正常调用流程
2. 错误处理流程
3. 权限验证流程
4. 并发调用场景

**测试覆盖率要求**：
- 单元测试：≥ 90%
- 集成测试：≥ 80%
- 安全测试：100% 覆盖

### 10.7 部署规范

**本地部署检查清单**：
- [ ] 环境变量配置正确
- [ ] 依赖安装完整
- [ ] 类型检查通过
- [ ] 单元测试通过
- [ ] 安全扫描通过

**远程部署检查清单**：
- [ ] HTTPS 配置正确
- [ ] 防火墙规则配置
- [ ] 监控告警配置
- [ ] 备份策略配置
- [ ] 灾难恢复计划

### 10.8 版本控制规范

**工具版本格式**：`主版本.次版本.修订版本`
- 主版本：破坏性变更（不向后兼容）
- 次版本：新增功能
- 修订版本：错误修复

**变更记录位置**：
- 主版本/次版本：`DECISIONS.md` 新增条目
- 修订版本：本文档修订历史章节

### 10.9 向后兼容性保证

**必须保证的兼容性**：
1. 工具接口：新增参数必须可选
2. 资源格式：新增字段必须可选
3. 错误码：新增错误码不得影响现有逻辑

**破坏性变更流程**：
1. 在 `DECISIONS.md` 标记为"超越条目"
2. 提供迁移指南
3. 设置废弃期（至少 2 个迭代周期）
4. 更新所有相关文档

### 10.10 监控与告警规范

**必须监控的指标**：
1. 工具调用成功率（目标：≥ 99%）
2. 工具调用延迟（目标：P95 ≤ 5秒）
3. 资源加载成功率（目标：≥ 99%）
4. 错误率（目标：≤ 1%）

**告警阈值**：
- 工具调用成功率 < 95%：立即告警
- 工具调用延迟 P95 > 10秒：警告
- 错误率 > 5%：立即告警
- 连续失败 3 次：立即告警
