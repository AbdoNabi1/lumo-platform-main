# 13 — Observability: logging, monitoring, error handling

> **Status: CONTRACT — 2026-06-28.** Defines logging, metrics/monitoring, tracing, and error
> handling. Instrumentation is a default, not an afterthought.

## 1. Foundation

**OpenTelemetry** everywhere (vendor-neutral): traces, metrics, logs share trace/correlation ids.
Backends: **Grafana stack** (Prometheus metrics, Loki logs, Tempo traces) self-hosted; **Sentry**
for frontend + backend exceptions with release/source-map tracking. Wrapped in `packages/telemetry`
with naming conventions so instrumentation is uniform.

## 2. Logging

| Rule | Detail |
|---|---|
| Structured only | JSON via `packages/logger` (pino); no `console.log` in shipped code |
| Correlation | every log carries `traceId`, `spanId`, service, environment, principal (if any) |
| PII redaction | emails/phones/PAN/child-data redacted at the logger; raw PII never logged |
| Levels | error/warn/info/debug; sampling on high-volume info/debug |
| Retention | hot in Loki (short), archived to object storage; audit logs separate + WORM (doc 14) |

## 3. Monitoring

- **Metrics:** RED (rate/errors/duration) per service + USE (utilization/saturation/errors) per resource; business KPIs (orders/min, checkout success, payment failure rate, queue lag, feed sync success).
- **SLOs** with error budgets per critical journey:

| Journey | SLO target |
|---|---|
| Storefront page (LCP) | ≤ 2.5s p75 |
| API | p99 ≤ 500ms |
| Search | p99 ≤ 200ms |
| Checkout submit | p99 ≤ 1s |
| Pricing computation | p99 ≤ 100ms |

- **Alerting:** symptom-based (SLO burn, queue lag, DLQ growth, payment-failure spike), routed by severity; runbooks linked from every alert; on-call rotation. No alert without an action.
- **Dashboards** as code (Grafana) in `infrastructure/observability`.

## 4. Tracing

Distributed traces span edge → gateway → services → DB/broker. Every async hop (events, jobs,
workflows) propagates trace context so an order's full lifecycle is traceable end to end.

## 5. Error handling

| Principle | Detail |
|---|---|
| Explicit, never swallowed | Errors handled at every level; no empty catch blocks |
| Result vs exception | `Result<T,E>` (`packages/core`) for expected business failures (e.g. invalid address); exceptions reserved for unexpected failures (DB down) |
| Uniform envelope | `{ code, message, traceId, fields[], retryable }` to clients (doc 04) |
| Retry policy | retryable errors flagged; exponential backoff + jitter; idempotency keys make retries safe |
| Dead-letter + replay | failed events/jobs go to DLQ with alerting; replayable after fix |
| Saga compensation | orchestrated flows roll back via compensating actions (doc 05) |
| Blast-radius control | circuit breakers, timeouts, bulkheads on outbound integrations |
| User-facing | clear, non-leaking messages; never raw exceptions or stack traces to users |

## Requires ADR to change

- The OpenTelemetry + Grafana/Sentry stack.
- The SLO targets, the Result-vs-exception rule, or the DLQ/compensation requirements.
