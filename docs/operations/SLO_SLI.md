# SLOs, SLIs & Error Budgets

> H-5 Production Readiness. These are the contractual reliability targets for the Morbeh runtime.
> Every SLI is computed from a metric the runtime **actually exposes** (`apps/runtime/src/metrics.ts`)
> and encoded as a Prometheus recording rule in
> [`slo.recording.rules.yml`](../../infrastructure/docker/prometheus/rules/slo.recording.rules.yml).

## Service Level Indicators (SLIs)

| SLI               | Definition                                     | Recording rule                  | Source metrics                                                                 |
| ----------------- | ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| API availability  | successful (non-5xx) requests ÷ total requests | `sli:api_availability:ratio5m`  | `http_requests_total{status}`                                                  |
| API latency       | avg request handling time (ms)                 | `sli:api_latency_ms:avg5m`      | `http_request_duration_ms_sum`, `http_requests_total`                          |
| Messaging success | processed ÷ (processed + dead-lettered)        | `sli:messaging_success:ratio5m` | `messaging_messages_processed_total`, `messaging_messages_dead_lettered_total` |
| Readiness         | `runtime_ready == 1`                           | (raw)                           | `runtime_ready`                                                                |

> **Latency is an average, not a percentile.** The runtime's hand-rolled exposition accumulates a
> duration _sum_ + request _count_ (no histogram buckets), so only the mean is defensible. p95/p99
> latency requires OTel histogram buckets (`http_request_duration_bucket`) — a tracked future
> enhancement, deliberately **not** faked in the recording rules. Security latencies (`authn/authz`)
> _do_ have buckets because they flow through the OTel pipeline (H-4).

## Service Level Objectives (SLOs)

| Objective         | Target                              | Window      | Rationale                                   |
| ----------------- | ----------------------------------- | ----------- | ------------------------------------------- |
| API availability  | **99.9 %**                          | 30 days     | ~43 min/month error budget                  |
| API latency       | 99 % of window under **300 ms** avg | 30 days     | request-path budget for the tsx runtime     |
| Messaging success | **99.5 %**                          | 30 days     | tolerates transient poison messages via DLQ |
| Deployment        | zero-downtime rollout               | per release | `maxUnavailable: 0` + PDB `minAvailable: 1` |

## Error budget & burn-rate alerting

The 99.9 % availability SLO leaves a **0.1 % error budget** (≈ 43 min/month). Two multi-window
burn-rate alerts (Google SRE workbook pattern) fire from
[`alerts.rules.yml`](../../infrastructure/docker/prometheus/rules/alerts.rules.yml):

| Alert                    | Condition                           | Meaning                   | Severity |
| ------------------------ | ----------------------------------- | ------------------------- | -------- |
| `ApiErrorBudgetFastBurn` | burn5m > 14.4 **and** burn1h > 14.4 | budget gone in ~2 days    | page     |
| `ApiErrorBudgetSlowBurn` | burn1h > 3                          | sustained elevated errors | ticket   |

Burn rate = `observed_error_ratio / (1 - SLO)`. A burn rate of 1 spends the budget exactly over the
30-day window; 14.4 spends it 14.4× faster.

## Reviewing the budget

- **Grafana** → _Morbeh / Platform Overview (SLO)_ shows availability, burn, and latency live.
- When the monthly budget is exhausted, the release train pauses for reliability work (policy, not
  tooling — see [OPERATIONS_GUIDE](OPERATIONS_GUIDE.md#error-budget-policy)).
