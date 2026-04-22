# Handoff and Iteration Guide

## 1. Product Intent

- Goal: determine if link target content is still accessible.
- Prioritize high-coverage practical detection over theoretical 100% reach.
- SaaS-first with reserved hybrid evolution path.

## 2. What Is Already Implemented

- Monorepo scaffold, API, worker, web chat UI
- HTTP + browser + AI classification chain
- 20-platform adapter baseline in shared config
- CSV/XLSX export
- AI Tool Calling (`fetch_url`) integration

## 3. Known Next Iteration Priorities

1. Agent execution routing (cloud vs local)
2. Webhook notification channels
3. better review queue operation workflow
4. metrics dashboard and alerting panel

## 4. New Chat Bootstrap Prompt (recommended)

When opening a new AI chat, provide:

- project path: `e:\my-project\linkscope`
- read files first:
  - `README.md`
  - `docs/ARCHITECTURE.md`
  - `docs/HANDOFF.md`
- objective: continue from existing MVP without rebuilding scaffolding

## 5. Runtime Checklist

- Docker Desktop running
- Postgres and Redis healthy
- API at `:3001`, Web at `:3000`
- DeepSeek key configured

## 6. Definition of Done for each iteration

- typecheck passes for API/Web
- smoke path executes successfully
- updated docs in `docs/`
- no plaintext secret committed