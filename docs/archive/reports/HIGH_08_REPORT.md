# HIGH-08 — Observability / Prometheus

**Source finding:** `H2-7` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` — _"Prometheus cannot scrape the
runtime, and the API omits half its metrics."_
**Type:** Remediation. Code + infra changed. **Public contract impact:** `HttpMetricsSink` gains one
optional method (`updateHealth`); every existing implementation and test fake stays valid unchanged.

---

## 1. Investigate

- `infrastructure/docker/prometheus/prometheus.yml` — scrape jobs were `prometheus`, `otel-collector`,
  `redpanda`. **No `lumo-runtime` job.**
- `infrastructure/docker/prometheus/rules/alerts.rules.yml` — `RuntimeProcessDown`,
  `MessagingDeadLettering`, `RuntimeHighMemory` all select on `job="lumo-runtime"` — unselectable
  without the job existing.
- `packages/http/src/server.ts`'s `/metrics` handler (before this change) called only
  `deps.metrics?.renderHttp()`, and `RuntimeMetrics.renderHttp()` (before this change) emitted only
  `http_requests_total`/`http_request_duration_ms_sum` — never `runtime_ready`/`runtime_dependency_up`.
- `apps/runtime/src/metrics.ts`'s `updateHealth()` (populates those two gauges) was called **only** from
  `apps/runtime/src/health-server.ts:34` — the worker/scheduler's bare-Node health surface. The API's
  Fastify `/readyz` handler never called it.
- `infrastructure/docker/docker-compose.yml` has no `api`/`worker`/`scheduler` services at all — a
  separate file, `infrastructure/docker/docker-compose.runtime.yml`, is referenced by
  `docs/operations/DEPLOYMENT_GUIDE.md`'s "Deploy locally (parity)" section (_"Prometheus scrapes each
  runtime `/metrics` (`lumo-runtime` job)"_) but **did not exist** — the documented local-parity command
  had nothing to apply.

**Impact confirmed by reading:** in the compose observability stack, no runtime metric was collected at
all — three of eight alert rules could never fire. Independently, even once collected, `runtime_ready`
and `runtime_dependency_up` were never emitted by the **API** specifically — the tier serving customer
traffic — so `RuntimeNotReady`/`DependencyDown` were blind to it (the worker/scheduler already exposed
both correctly).

## 2. Implement — code (closes "API omits half its metrics")

- `packages/http/src/server.ts` — `HttpMetricsSink` gains an **optional** `updateHealth?(report:
HealthReport): void`; the `/readyz` handler now calls `deps.metrics?.updateHealth?.(report)` after
  running the health check, mirroring exactly what `health-server.ts` already does for the
  worker/scheduler.
- `apps/runtime/src/metrics.ts` — `RuntimeMetrics.renderHttp()` (the method the API's `/metrics` actually
  calls) now also renders `runtime_ready`/`runtime_dependency_up`, reusing the same gauges `render()`
  already exposes for the worker/scheduler. Messaging gauges stay excluded (the API is not a Kafka
  consumer).

**Prove:**

- `apps/runtime/src/metrics.test.ts` — new case asserting `renderHttp()` (not just `render()`) contains
  `runtime_ready`/`runtime_dependency_up` after `updateHealth()`.
- `packages/http/src/server.test.ts` — two new cases: a fake `HttpMetricsSink` receives exactly one
  `updateHealth` call per `/readyz` request with the real report; and `/readyz` does not throw when the
  injected sink omits `updateHealth` (proves the optional-method addition is backward compatible).

## 3. Implement — Prometheus coverage (closes "cannot scrape the runtime")

- `infrastructure/docker/docker-compose.runtime.yml` (new) — the missing file `DEPLOYMENT_GUIDE.md`
  already documents: one image (`runtime.Dockerfile`) for `api`/`worker`/`scheduler`, differing only in
  `command`, wired to the existing `postgres`/`redis`/`redpanda` compose services by their real service
  DNS names. `AUTH_ISSUER_URL`/`AUTH_JWKS_URL` are unconditionally required
  (`composition.ts:118` — "no fake identity provider") but no Ory stack runs in this compose file yet;
  placeholder values let the process boot (`APP_ENV=local` keeps every other guard permissive) so
  `/healthz`, `/readyz`, `/metrics` are real and scrapable — documented inline as a pre-existing gap, not
  claimed as working authentication.
- `infrastructure/docker/prometheus/prometheus.yml` — added the `lumo-runtime` job with three static
  targets (`api:3080`, `worker:3080`, `scheduler:3080`, labelled by `component`), matching exactly the
  job name the alert/recording rules already select on.

**Prove (infra):** loaded both files through `js-yaml` — confirmed the compose file's YAML anchors/merge
keys (`&runtime-env`, `<<: *runtime-env`) resolve correctly (verified by inspecting the merged `api`
service object), and the Prometheus config parses into the expected `scrape_configs` array with the new
job. The healthcheck command was corrected mid-implementation from `wget` (not installed in the
`node:22-bookworm-slim` base `runtime.Dockerfile` uses — confirmed by reading the Dockerfile's own `apt-get
install` line) to the same `node -e` one-liner the image's own `HEALTHCHECK` already uses.

## 4. Run

| Gate             | Result                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pnpm typecheck` | ✅ 76/76                                                                           |
| `pnpm lint`      | ✅ 76/76                                                                           |
| `pnpm test`      | ✅ 76/76 tasks; `@platform/runtime` 133 tests (+1); `@platform/http` 23 tests (+2) |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps)                            |

## 5. Scope discipline

No architecture change, no new bounded context. One additive optional interface member
(`HttpMetricsSink.updateHealth`) — every existing caller and test fake remains valid without
modification. `docker-compose.runtime.yml` and the Prometheus job are new/appended infra config only;
no k8s manifest (the cluster side already carries `prometheus.io/scrape` pod annotations from prior
sprints — relabelling an external cluster Prometheus to the literal `lumo-runtime` job name is outside
this repository's control, per the audit's own parenthetical alternative).
