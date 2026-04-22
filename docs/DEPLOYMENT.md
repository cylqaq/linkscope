# Deployment Guide

## 1. Prerequisites

- Windows 10/11, macOS, or Linux
- Node.js 22+
- pnpm 10+
- Docker Desktop running

## 2. Environment Setup

1) install dependencies

```bash
pnpm install
```

2) create env file

- copy `.env.example` to `apps/api/.env`
- set `DEEPSEEK_API_KEY`

3) required variables

- `DATABASE_URL`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `AI_PROVIDER`, `DEEPSEEK_*`

## 3. Start Services

```bash
docker-compose up -d postgres redis
pnpm db:push
pnpm dev
```

## 4. Verify

```bash
pnpm --filter @linkscope/api typecheck
pnpm --filter @linkscope/web typecheck
```

Optional smoke test:

```bash
node smoke-test.mjs
```

## 5. Docker Desktop Troubleshooting (Windows)

If Docker Desktop flashes and exits:

1) remove stale install directories:

- `C:\Program Files\Docker\Docker.staging`
- `C:\ProgramData\DockerDesktop`

2) ensure WSL features enabled and reboot.

3) reinstall Docker Desktop as administrator.

4) verify:

```bash
wsl -l -v
docker version
docker run --rm hello-world
```