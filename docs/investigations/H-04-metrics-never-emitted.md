# H-04 — Every SLO rule, alert, and dashboard queries metrics the runtime never emits

| Field                      | Value                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High                                                                                                                                                                      |
| **Area**                   | Observability                                                                                                                                                             |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                                        |
| **Blocker verdict**        | **True blocker.** Not a deferral — `apps/runtime/src/metrics.ts`, the file the SLO rules cite by name, was written and dropped from `main`. It is preserved in `de46df9`. |
| **Public contract change** | **No.** The HTTP sink is an additive-optional port, by its own design.                                                                                                    |

---

## 1. Location

| File                                                             | Lines   | What is there                                                                                            |
| ---------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `packages/http/src/server.ts`                                    | 347–358 | `/metrics` — emits **three** process gauges, nothing else                                                |
| `infrastructure/docker/prometheus/rules/slo.recording.rules.yml` | 1–13    | Header citing **`apps/runtime/src/metrics.ts`** — a file that does not exist on `main`                   |
| `infrastructure/docker/prometheus/rules/slo.recording.rules.yml` | 20–58   | Recording rules over `http_requests_total`, `http_request_duration_ms_sum`, `messaging_messages_*_total` |
| `infrastructure/docker/prometheus/rules/alerts.rules.yml`        | 1–3     | _"Every alert references a metric the platform actually exposes"_ — **false**                            |
| `infrastructure/docker/prometheus/rules/alerts.rules.yml`        | 16, 25  | Alerts on `runtime_ready`, `runtime_dependency_up`                                                       |
| `packages/kafka/src/consumer-runtime.ts`                         | 73      | `this.metrics = deps.metrics ?? noopMetrics`                                                             |
| `apps/runtime/src/composition.ts`                                | 203–217 | `new KafkaConsumerRuntime({...})` — **no `metrics` passed**                                              |
| `apps/runtime/src/security/security-telemetry-otel.ts`           | 15      | `OtelSecurityTelemetry` — unreachable (H-02)                                                             |

**Absent from `main`, present in `de46df9`:** `apps/runtime/src/metrics.ts`, `apps/runtime/src/health-server.ts`, `apps/runtime/src/diagnostics.ts`.

---

## 2. Current implementation

### 2a. What `/metrics` actually emits

```ts
// packages/http/src/server.ts:347-358
app.get("/metrics", async (_request, reply) => {
  const memory = process.memoryUsage();
  const lines = [
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${memory.rss}`,
    "# TYPE nodejs_heap_used_bytes gauge",
    `nodejs_heap_used_bytes ${memory.heapUsed}`,
  ];
  return reply.type("text/plain; version=0.0.4").send(`${lines.join("\n")}\n`);
});
```

Three process gauges. No request counter, no latency accumulator, no readiness gauge, no dependency gauges, no messaging counters.

### 2b. What the rules expect

```yaml
# infrastructure/docker/prometheus/rules/slo.recording.rules.yml:1-13
# SLIs are derived ONLY from metrics the runtime actually exposes (see apps/runtime/src/metrics.ts):
#   http_requests_total{method,status}          counter
#   http_request_duration_ms_sum{method,status} counter
#   runtime_ready                               gauge (1 healthy/degraded, 0 unhealthy)
#   messaging_messages_{processed,failed,dead_lettered}_total{topic,group} counters
```

`apps/runtime/src/metrics.ts` **does not exist on `main`**:

```
$ git ls-files | grep 'metrics\.ts$'
packages/entitlement/src/metrics.ts
packages/kafka/src/metrics.ts
packages/observability/src/metrics.ts
```

`alerts.rules.yml` additionally uses `runtime_dependency_up` (line 25), also never emitted, under a header that asserts the opposite:

```yaml
# H-5 — Production alerting rules. Every alert references a metric the platform actually exposes
```

### 2c. Messaging metrics are structurally disabled too

```ts
// packages/kafka/src/consumer-runtime.ts:73
this.metrics = deps.metrics ?? noopMetrics;
```

`buildPaymentCapturedRuntime` (`apps/runtime/src/composition.ts:203-217`) passes `kafka`, `handler`, `consumerGroup`, `serializer`, `processedEvents`, `deadLetters`, `retryPublisher`, `clock`, `logger` — **not `metrics`**. Every `this.metrics.processed(...)`, `.failed(...)`, `.retried(...)`, `.deadLettered(...)`, `.duplicate(...)` call in that class is a no-op.

### 2d. The missing file exists and is exactly the right implementation

`git show de46df9:apps/runtime/src/metrics.ts` is a dependency-free Prometheus text renderer implementing `MessagingMetrics` plus a structural HTTP sink:

```ts
export class RuntimeMetrics implements MessagingMetrics {
  processed(topic, consumerGroup, durationMs) { … }   // messaging_messages_processed_total + duration_sum
  failed(topic, consumerGroup) { … }
  retried(topic, consumerGroup) { … }
  deadLettered(topic, consumerGroup) { … }
  duplicate(topic, consumerGroup) { … }

  recordHttp(method, status, durationMs) { … }        // http_requests_total + http_request_duration_ms_sum

  /** Reflect the last readiness report as `runtime_dependency_up` gauges + `runtime_ready`. */
  updateHealth(report: HealthReport): void { … }
}
```

Its header states the design:

> _"Lightweight, dependency-free runtime metrics (F5 / G-19). Hand-rolled Prometheus text — no SDK, no OTel, no `prom-client`. … Two consumption shapes: `MessagingMetrics` (implemented) — passed to the Kafka consumer runtime (Worker); `HttpMetricsSink` (structural) — the additive-optional port the HTTP transport calls; plus process metrics, dependency-up gauges (from the last readiness report) and a liveness gauge."_

Every metric name the rules reference is produced by this file.

---

## 3. Why it is incorrect

Two config files make factual claims about the repository that are false — and they are the files an on-call engineer trusts most.

1. **`slo.recording.rules.yml` cites a source file that does not exist**, as its justification for which metrics are safe to build SLIs from.
2. **`alerts.rules.yml` asserts every alert references an exposed metric.** Of its rules, only `up{job="morbeh-runtime"} == 0` (Prometheus scrape failure) survives.

The consequence is worse than absent monitoring, because the recording rules are written with divide-by-zero guards that **fail towards "healthy"**:

```yaml
# slo.recording.rules.yml
- record: sli:api_availability:ratio5m
  expr: |
    1 - (job:http_requests_errors:rate5m / clamp_min(job:http_requests:rate5m, 1))
```

With no `http_requests_total` series at all, `job:http_requests_errors:rate5m` is empty and the expression evaluates to **`1` — perfectly available — permanently**. `clamp_min(..., 1)` was added to guard the no-traffic case; it cannot distinguish "no traffic" from "no instrumentation". The same holds for `sli:messaging_success:ratio5m` and both error-budget burn rates.

---

## 4. Production impact

**Green dashboards during a total outage.**

- `ApiErrorBudgetFastBurn`, `ApiErrorBudgetSlowBurn`, `ApiLatencyBudgetBreached` — can never fire. Burn rate is always `0/1 / 0.001 = 0`.
- `RuntimeNotReady` (`runtime_ready == 0`) and `DependencyDown` (`runtime_dependency_up == 0`) — can never fire. Postgres or Redis could be down and the alert stays silent while `/readyz` correctly returns 503, because nothing translates the readiness report into a metric.
- Messaging is entirely unobserved: no processed rate, no failure rate, **no dead-letter rate**. C-08's unbounded outbox growth and H-05's consumer stall would both be invisible.
- Combined with **H-10** (OTel never started), production has neither metrics nor traces. The only telemetry is the structured request log at `packages/http/src/server.ts:118-128`.
- The three Grafana dashboards (`platform-overview.json`, `messaging.json`, `security.json`) render empty or "No data" panels.

The single surviving signal — `up{job="morbeh-runtime"} == 0` — detects only that the process stopped answering scrapes.

---

## 5. Smallest additive fix

**Restore, then wire in three places.**

### Step 1 — restore

```bash
git checkout de46df9 -- apps/runtime/src/metrics.ts
```

Consider restoring `apps/runtime/src/health-server.ts` and `apps/runtime/src/diagnostics.ts` in the same commit — `health-server.ts` is how the worker and scheduler (which have no HTTP server today) expose `/healthz`, `/readyz`, and `/metrics`, and `infrastructure/k8s/21-` and `22-` define probes against those endpoints.

### Step 2 — construct once, share across the three consumption points

```ts
// apps/runtime/src/composition.ts — add to RuntimeCore
readonly metrics: RuntimeMetrics;
// in buildRuntimeCore:
const metrics = new RuntimeMetrics();
```

**(a) Messaging** — one added property:

```ts
// apps/runtime/src/composition.ts:203-217
return new KafkaConsumerRuntime({
  kafka: core.kafka,
  handler: new PaymentCapturedConsumer({ markOrderPaid, logger: core.logger }),
  ...
  metrics: core.metrics,          // ← was defaulting to noopMetrics
});
```

**(b) HTTP** — an additive-optional sink on `HttpServerDeps`, called from the existing `onResponse` hook that already computes `reply.elapsedTime`:

```ts
// packages/http/src/server.ts:118-128
app.addHook("onResponse", async (request, reply) => {
  deps.metrics?.recordHttp(request.method, reply.statusCode, reply.elapsedTime);   // ← added
  deps.logger.info("http request", { ... });                                        // unchanged
});
```

and append `deps.metrics?.renderHttp()` to the existing `/metrics` body at line 356.

**(c) Readiness** — `updateHealth` from the existing `/readyz` handler:

```ts
// packages/http/src/server.ts:343-346
app.get("/readyz", async (_request, reply) => {
  const report = await deps.health.run();
  deps.metrics?.updateHealth(report); // ← emits runtime_ready + runtime_dependency_up
  return reply.status(report.status === "unhealthy" ? 503 : 200).send(report);
});
```

### Step 3 — correct the two false comments

- `slo.recording.rules.yml:1-13` — the citation becomes true once Step 1 lands, but re-verify the metric list matches `RuntimeMetrics`' actual output.
- `alerts.rules.yml:1-3` — verify the claim before restoring it as an assertion.

### Note on histograms

`slo.recording.rules.yml:6-9` is explicit that only an average is available and that fabricating a p95 was deliberately avoided: _"percentiles need histogram buckets, tracked as a future OTel enhancement, so we intentionally do NOT fabricate a p95 here."_ That is good judgement and should be preserved — do not add a p95 panel on top of a `_sum` counter.

---

## 6. Public contract impact

**None.**

- `HttpServerDeps.metrics` is a **new optional** field. Every existing caller (`apps/admin/src/http/server.ts:41-56`, all tests) compiles and behaves identically. The `de46df9` implementation was designed for exactly this — it calls the sink _"structural"_ and _"additive-optional"_.
- `KafkaConsumerRuntimeDeps.metrics` already exists and is already optional (`packages/kafka/src/consumer-runtime.ts:34`). Passing it is not a contract change.
- `/metrics` gains series; the three existing gauges keep their names and types. Prometheus scrape config is unchanged.
- `MessagingMetrics` (`@platform/kafka`) is unchanged — `RuntimeMetrics` implements it as-is.

---

## 7. Blocker or intentional deferral?

**True blocker — and a partial deferral that has been overtaken.**

`docs/KNOWN_GAPS.md` tracks **G-19** (_"OTel spans/metrics wiring (collector seams exist)"_, impact _"observability blind spots"_, P1, status `seam`). So _some_ observability work is knowingly outstanding.

But the SLO and alert rules were shipped as though the work were **done** — `alerts.rules.yml` opens by asserting every alert references an exposed metric, and `slo.recording.rules.yml` names the source file. Those files were authored against `apps/runtime/src/metrics.ts`, which existed at the time and did not survive onto `main`. This is the same **file-loss defect** as C-02, C-03, C-04, and C-07.

Deploying with monitoring that reports constant perfect availability is worse than deploying with no monitoring, because it removes the operator's incentive to look. **Verdict: true blocker**, and — given the implementation already exists — a cheap one.

---

## 8. How this was verified

- `packages/http/src/server.ts:337-359` read in full — three gauges, nothing more.
- `git ls-files | grep 'metrics\.ts$'` → 3 files, none in `apps/runtime`.
- `infrastructure/docker/prometheus/rules/slo.recording.rules.yml` read in full.
- `infrastructure/docker/prometheus/rules/alerts.rules.yml` read (first 60 lines).
- `packages/kafka/src/consumer-runtime.ts` read in full — `noopMetrics` default at line 73; `apps/runtime/src/composition.ts:203-217` confirmed to omit `metrics`.
- `git grep -n "createCounter\|createHistogram\|prom-client"` → only `packages/observability` and the unreachable `apps/runtime/src/security/security-telemetry-otel.ts`.
- `git show de46df9:apps/runtime/src/metrics.ts` read (~140 lines) — implements `MessagingMetrics`, `recordHttp`, `updateHealth`, and emits every metric name the rules reference.
- File-set diff → `metrics.ts`, `health-server.ts`, `diagnostics.ts` absent from `main`.
- No code was modified.
