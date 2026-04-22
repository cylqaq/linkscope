# LinkScope

LinkScope 是一个面向中国大陆业务场景的全网链接内容有效性检测平台，产品形态为 SaaS 优先，V1 即接入 AI 判定。

核心目标是判断“目标内容是否可访问”，而非仅判断 URL 是否可连通。

## Core Output

- `accessible`：正常可访问内容
- `dead_link`：失效链接
- `review_required`：内部复核态（对外可映射为业务二分类策略）

## Product Highlights

- 对话式极简输入：粘贴文本或上传文件（txt/csv/xlsx/json）
- 批量检测：自动 URL 提取、规范化、去重
- 三层检测链路：
  - HTTP 探测（HEAD -> GET 回退）
  - 浏览器探测（Playwright，识别软 404）
  - AI 增强判定（DeepSeek，支持 Tool Calling）
- 证据链输出：状态码、最终 URL、重定向链、页面信号、截图
- 结果导出：CSV / XLSX

## Tech Stack

- Monorepo: pnpm workspace + Turbo
- Frontend: Next.js
- Backend: NestJS + BullMQ
- Data: PostgreSQL + Prisma
- Queue: Redis
- Browser: Playwright
- AI: DeepSeek (OpenAI-compatible)

## Quick Start

1) install dependencies

```bash
pnpm install
```

2) prepare env

- copy `.env.example` to `apps/api/.env`
- fill `DEEPSEEK_API_KEY`

3) start dependencies and apps

```bash
docker-compose up -d postgres redis
pnpm db:push
pnpm dev
```

4) open

- Web: `http://localhost:3000`
- API: `http://localhost:3001/api`

## Documentation

- `docs/ARCHITECTURE.md`: system design and state flow
- `docs/DEPLOYMENT.md`: installation, startup, troubleshooting
- `docs/HANDOFF.md`: iteration guide for new chats and new team members
- `docs/SECURITY_OPS.md`: security, audit, quality, and observability baseline