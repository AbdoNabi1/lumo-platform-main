# P1.2 — Restore Runtime Metrics

**Milestone:** P1.2
**Closes:** [H-04](../investigations/H-04-metrics-never-emitted.md)
**Also closes a defect found during execution:** the worker and scheduler had no HTTP surface at all, so their k8s probes could never succeed (see §3.2).
**Baseline:** `3baada5` (P1.1)
**Date:** 2026-08-04
**Method:** restore `metrics.ts` and `health-server.ts` from `de46df9`; wire them into `main`'s existing entrypoints; verify by live HTTP scrape, not by inspection.

---

## 1. Objective

Investigation H-04 found that every SLO recording rule, every alert, and all three Grafana dashboards queried metrics the runtime never emitted. `/metrics` returned three process gauges. The recording rules' own header cited `apps/runtime/src/metrics.ts` — **a file that did not exist on `main`**.

The failure mode was worse than absent monitoring, because the rules' divide-by-zero guards fail _towards healthy_:

```yaml
- record: sli:api_availability:ratio5m
  expr: 1 - (job:http_requests_errors:rate5m / clamp_min(job:http_requests:rate5m, 1))
```

With no `http_requests_total` series at all this evaluates to a constant **`1` — perfectly available — permanently.** `ApiErrorBudgetFastBurn`, `ApiErrorBudgetSlowBurn`, `ApiLatencyBudgetBreached`, `RuntimeNotReady` and `DependencyDown` could never fire.

---

## 2. Restored files

| File                                | Purpose                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/runtime/src/metrics.ts`       | `RuntimeMetrics` — dependency-free Prometheus text renderer implementing `MessagingMetrics` + an HTTP sink + readiness gauges |
| `apps/runtime/src/health-server.ts` | `startHealthServer` — framework-free `/healthz` · `/readyz` · `/metrics` for the non-Fastify processes                        |

**2 files restored verbatim from `de46df9`. 0 files rewritten.**

### What was deliberately _not_ restored

`de46df9`'s `worker.ts` boots through a Phase-4B module framework (`platform.ts`, `module.ts`, `modules/*.module.ts` — ~80 files) which also registers `purchaseSagaModule()`. That saga implementation is flagged **by `de46df9`'s own commit message** as carrying confirmed defects SAGA-1…SAGA-11, and the milestone brief explicitly forbids restoring it. The two metrics primitives were therefore wired into `main`'s existing simple entrypoints instead of adopting the framework. No module framework, no saga, no redesign.

---

## 3. Files modified

### 3.1 The metrics seam (7 files)

| File                               | Change                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/http/src/server.ts`      | Added the `HttpMetricsSink` port + `metrics?` on `HttpServerDeps`; call `recordHttp` in the existing `onResponse` hook; append `renderHttp()` to `/metrics` |
| `packages/http/src/index.ts`       | Export `type HttpMetricsSink`                                                                                                                               |
| `apps/runtime/src/composition.ts`  | `metrics: RuntimeMetrics` on `RuntimeCore`, constructed once per process; passed to `KafkaConsumerRuntime`                                                  |
| `apps/runtime/src/api.ts`          | Pass `metrics` into `createAdminHttpApi`                                                                                                                    |
| `apps/admin/src/http/server.ts`    | Accept `metrics?` on `AdminHttpDeps`, forward to `HttpServerDeps`                                                                                           |
| `apps/runtime/src/index.ts`        | Export `RuntimeMetrics`, `startHealthServer`, `type MetricsSource`                                                                                          |
| `apps/runtime/src/metrics.test.ts` | **New** — 5 regression tests (§4.1)                                                                                                                         |

**`packages/http/src/server.ts` was NOT overwritten from the reference.** `main`'s copy is newer — it carries the Phase-9 public-route support, `GuardRequestContext`, the `sessionClaim` dual-name fix, and the security-headers layer, none of which exist in `de46df9`. A wholesale restore would have regressed 33 lines of later work. Only the metrics seam was ported across, taking the exact shapes from the reference.

### 3.2 Worker and scheduler had no HTTP surface — found during execution

Not in H-04, found while verifying "Prometheus exposure". Both manifests probe an endpoint neither process serves:

```yaml
# infrastructure/k8s/21-deployment-worker.yaml
prometheus.io/port: "3080"      prometheus.io/path: "/metrics"
containerPort: 3080             # health + metrics only (no business traffic)
startupProbe:   httpGet: { path: /healthz, port: http }
livenessProbe:  httpGet: { path: /healthz, port: http }
readinessProbe: httpGet: { path: /readyz,  port: http }
```

`worker.ts` and `scheduler.ts` started **no HTTP server**. Both pods would have failed every probe: never ready, and killed by liveness after `failureThreshold: 3`. The scheduler (`replicas: 1`) would have crash-looped indefinitely, so outbox pruning would never have run.

`startHealthServer(runtime.health, config.PORT, runtime.metrics)` is now started in both, and closed in both shutdown paths. This is also what makes the `messaging_messages_*` series scrapeable at all — they are emitted **in the worker process**, which previously had no way to expose them.

---

## 4. Verification

### 4.1 Regression tests — the rules are read, not copied

`apps/runtime/src/metrics.test.ts` parses the **actual** `slo.recording.rules.yml` and `alerts.rules.yml` and asserts every base series they query appears in the exposition. A rule that starts querying a new metric now fails this test instead of silently producing an alert that can never fire.

Three series are explicitly excluded with recorded reasons: `up` (synthesised by Prometheus), and `failed_logins` / `authorization_latency_bucket`, which come from the OTel security telemetry that the rule file itself annotates as conditional — _"Requires the OTel pipeline (H-4). Absent metric → no alert, which is correct here."_ Those belong to H-02/H-10, not this milestone.

Tests added:

1. every rule-referenced base metric is present in the exposition
2. counters render as `0` before any traffic (the H-04 failure mode was _silence_, not wrong numbers)
3. messaging outcomes counted by `{topic, group}`
4. HTTP responses counted by `{method, status}` — the exact labels the availability SLI divides
5. readiness report → `runtime_ready` + per-dependency `runtime_dependency_up`

`@platform/runtime`: **107 → 112 tests passing.**

### 4.2 Live HTTP scrape — actually executed

The real `startHealthServer` was started with a real `RuntimeMetrics` and a `HealthRegistry` whose `redis` probe throws, then scraped over HTTP:

```
GET /healthz -> 200 {"status":"ok"}
GET /readyz  -> 503                       (redis probe throws => fail closed)
GET /metrics -> 200

  runtime_ready                          runtime_ready 0
  runtime_dependency_up                  runtime_dependency_up{name="postgres"} 1
  messaging_messages_processed_total     messaging_messages_processed_total{group="orders.payment-captured",topic="payments.payment_intent.captured.v1"} 1
  messaging_messages_dead_lettered_total messaging_messages_dead_lettered_total{group="orders.payment-captured",topic="payments.payment_intent.captured.v1"} 1
  process_resident_memory_bytes          process_resident_memory_bytes 80322560
```

This proves three things inspection could not: the exposition parses as Prometheus text over a real socket; `/readyz` fail-closes on a throwing probe; and `runtime_ready` correctly reports `0` for an unhealthy report — the exact condition `RuntimeNotReady` alerts on, which previously had no series behind it.

### 4.3 Metric coverage against the rules

| Metric                                   | Rule that queries it              | Emitted by                        |
| ---------------------------------------- | --------------------------------- | --------------------------------- |
| `http_requests_total{method,status}`     | availability SLI, both burn rates | API (`recordHttp` ← `onResponse`) |
| `http_request_duration_ms_sum`           | `sli:api_latency_ms:avg5m`        | API                               |
| `runtime_ready`                          | `RuntimeNotReady`                 | worker + scheduler health server  |
| `runtime_dependency_up{name}`            | `DependencyDown`                  | worker + scheduler health server  |
| `messaging_messages_processed_total`     | `sli:messaging_success:ratio5m`   | worker                            |
| `messaging_messages_dead_lettered_total` | `sli:messaging_success:ratio5m`   | worker                            |
| `process_resident_memory_bytes`          | `RuntimeHighMemory`               | all three                         |

---

## 5. Quality gate results

| Gate         | Command           | Result                                                         |
| ------------ | ----------------- | -------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck`  | ✅ 76 successful, 76 total                                     |
| Lint         | `pnpm lint`       | ✅ 76 successful, 76 total                                     |
| Test         | `pnpm test`       | ✅ 76 successful, 76 total (`@platform/runtime` 112 tests, +5) |
| Architecture | `pnpm arch`       | ✅ no dependency violations (1531 modules, 6529 dependencies)  |
| Governance   | `pnpm governance` | ⚪ not available (see P1.1 §7)                                 |
| Install      | `pnpm install`    | ⚪ not required — no dependency change                         |

`pnpm arch` passing matters here specifically: `HttpMetricsSink` is declared **in `packages/http`** as a structural port, so `@platform/http` still never imports `apps/` — the same technique already used for `PermissionGuard`.

---

## 6. Risks

| #   | Risk                                                                                                                                                                                             | Severity | Mitigation                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The API process does not emit `runtime_ready` / `runtime_dependency_up` — the reference's `HttpMetricsSink` is `recordHttp` + `renderHttp` only, and its `/readyz` does not call `updateHealth`. | Low      | Faithful to the restored design; widening the port would be a redesign. Coverage is not lost: the worker and scheduler register the _same_ `core.health` (postgres + redis), so a dependency outage still drives `runtime_ready == 0` and fires `DependencyDown`. Recorded as deferred (§7). |
| R2  | Counters are per-process and reset on restart.                                                                                                                                                   | Low      | Correct for Prometheus counters — `rate()` handles resets. No action.                                                                                                                                                                                                                        |
| R3  | The health server binds `config.PORT` (3080) in worker and scheduler. If a future change runs two runtime roles in one container, the second bind fails.                                         | Low      | `health-server.ts` logs bind errors and never crashes the host process (_"Health is auxiliary"_). One role per container is what the manifests specify.                                                                                                                                      |
| R4  | Metrics have never been scraped by a real Prometheus.                                                                                                                                            | Medium   | Exposition verified over HTTP (§4.2) and format-asserted in tests. End-to-end scrape needs the stack (C-09).                                                                                                                                                                                 |
| R5  | The two security series remain absent, so `ElevatedFailedLogins` and `AuthorizationLatencyHigh` still cannot fire.                                                                               | Medium   | Known, annotated in the rule file itself, and owned by H-02 (zero-trust runtime unmounted) + H-10 (OTel never started).                                                                                                                                                                      |

---

## 7. Deferred items

| Item                                                            | Reason                                                                                                                                                                              | Where it belongs                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `runtime_ready` from the API process                            | Would require widening `HttpMetricsSink` beyond the restored contract; coverage is already provided by worker + scheduler.                                                          | Optional follow-up; not blocking. |
| OTel SDK never started (`startRuntimeTelemetry` has no callers) | Distinct finding, distinct fix.                                                                                                                                                     | **H-10** — its own milestone.     |
| `failed_logins`, `authorization_latency_bucket`                 | Emitted by `OtelSecurityTelemetry`, which is unreachable.                                                                                                                           | **H-02**, then H-10.              |
| Latency percentiles (p95)                                       | The rule file deliberately avoids fabricating one over a `_sum` counter: _"percentiles need histogram buckets … we intentionally do NOT fabricate a p95 here."_ Correct; preserved. | Future OTel enhancement.          |
| Collector `/metrics` (its `counters()` are unexposed)           | Different app.                                                                                                                                                                      | **H-07**                          |

---

## 8. State after this milestone

**H-04 closed.** Every base series the SLO recording rules and alert rules query is now emitted by the process that owns it, verified by a live HTTP scrape and guarded by a test that reads the rule files directly.

**Bonus defect closed:** the worker and scheduler now serve the `/healthz` · `/readyz` · `/metrics` surface their k8s manifests have always probed. Before this commit both would have failed every probe and been killed by liveness.

---

## 9. Commit

Single isolated commit; working tree clean. No public API removed or renamed — `HttpMetricsSink` and both `metrics?` fields are additive and optional, so every existing caller compiles and behaves identically.
