# Security and Ops Baseline

## 1. Secrets

- Never commit real API keys.
- Keep keys in environment variables or secret manager.
- Mask secrets in logs.

## 2. Auditability

Persist AI judgement metadata:

- provider/model
- prompt version
- reasoning
- confidence
- token usage and latency

## 3. Reliability Controls

- retry with exponential backoff for transient failures
- dead-letter strategy for exhausted retries
- domain-level concurrency throttling

## 4. Observability (minimum)

- task throughput
- success/dead/review distribution
- probe error code distribution
- AI timeout/rate-limit rate

## 5. Compliance Notes

- respect target-site terms
- avoid credential abuse
- keep evidence trace for operator review