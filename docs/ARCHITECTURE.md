# Architecture

## 1. Core Pipeline

1. Task creation (`/api/tasks`) receives text/file URLs.
2. URL normalization and deduplication in task service.
3. BullMQ enqueues probe jobs per URL.
4. Worker executes:
   - L1 HTTP probe
   - L2 browser fallback (when needed)
   - L3 classification (rules + AI)
5. Results are stored in PostgreSQL and queryable/exportable.

## 2. Multi-layer Detection

- L1 HTTP Probe:
  - HEAD first, fallback GET on 405/501/failed cases.
  - track redirects, latency, transport errors.
- L2 Browser Probe:
  - Playwright page load and DOM text extraction.
  - soft-404 signal extraction and screenshot evidence.
- L3 AI Judge:
  - DeepSeek with OpenAI-compatible API.
  - Tool Calling enabled (`fetch_url`) for ambiguous links.
  - rule-first policy; AI used for uncertain or semantic cases.

## 3. Status Model

Internal status:

- ok
- removed
- soft_404
- hard_404
- login_required
- forbidden
- rate_limited
- transient_error
- risk_blocked
- unknown

External output:

- accessible
- dead_link
- review_required

## 4. Data Model (MVP)

- tasks
- task_urls
- probes_http
- probes_browser
- classifications
- ai_judgements

## 5. Queue and Reliability

- Redis + BullMQ queue: `probe`
- retry with backoff for transient failure
- non-retryable classes for hard dead links
- idempotent upsert of probe/classification data

## 6. Agent-ready Interface

Reserved API for hybrid mode:

- `POST /api/agents/register`
- `POST /api/agents/heartbeat`
- `POST /api/agents/:id/pull-jobs`

These endpoints allow future local-agent execution for intranet and login-state scenarios.