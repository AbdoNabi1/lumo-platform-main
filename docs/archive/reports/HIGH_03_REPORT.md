# HIGH-03 — Runtime Telemetry Wiring

**Source finding:** `H2-2` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` — _"OpenTelemetry never starts,
while the shipped config enables it."_
**Type:** Remediation. Code changed. **Public contract impact: none.**

---

## 1. Investigate

- `apps/runtime/src/telemetry.ts:14` — `startRuntimeTelemetry(config, role)` had **zero callers**
  repository-wide (verified: none of `api.ts`, `worker.ts`, `scheduler.ts` imported `./telemetry`).
- `infrastructure/k8s/10-config.yaml` — `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_ENABLED: "true"`,
  `OTEL_METRICS_ENABLED: "true"` are shipped as the default configuration.
- `packages/observability`'s `createTelemetry` returns a no-op `Telemetry` when both flags are false —
  confirmed by reading `packages/observability/src/sdk.ts:1-51` — so calling `startRuntimeTelemetry` is
  side-effect-free in every environment where the flags stay off (local, tests, and any deployment that
  has not explicitly opted in).
- No trace or OTel metric ever left any process. The security dashboards (`ElevatedFailedLogins`,
  `AuthorizationLatencyHigh` in `infrastructure/docker/prometheus/rules/alerts.rules.yml`) have no data
  source, and there is no distributed tracing across API → Kafka → worker.

## 2. Prove

Added `apps/runtime/src/telemetry.test.ts` (no existing test file covered this function at all) —
asserts the returned `Telemetry` is a working no-op when both flags are off (the shipped local/test
default) and that all three roles (`api`/`worker`/`scheduler`) can be started and shut down cleanly.

Added `apps/runtime/src/api.h-03-telemetry-regression.test.ts`, mocking `./telemetry` (same
mock-and-inspect convention as the V-1 and H-02 regressions) — asserts `startApi()` calls
`startRuntimeTelemetry(config, "api")` before serving traffic. Before this change the mock would never
have been called.

## 3. Implement

Three entrypoints, three lines each (matching the audit's own estimate):

- `apps/runtime/src/api.ts` — `startRuntimeTelemetry(config, "api")`, called after the existing
  fail-closed MFA/payment-provider guards (so a boot-time rejection never spins up telemetry just to
  immediately tear it down) and before `createAdminHttpApi`; `telemetry.shutdown()` added to the
  existing `shutdown()` handler alongside Redis/Prisma disconnect.
- `apps/runtime/src/worker.ts` — `startRuntimeTelemetry(config, "worker")` at the top of `startWorker`;
  `telemetry.shutdown()` added to its `shutdown()` handler.
- `apps/runtime/src/scheduler.ts` — `startRuntimeTelemetry(config, "scheduler")` at the top of
  `startScheduler`; `telemetry.shutdown()` added to its `shutdown()` handler.

**One sequencing fix mid-implementation:** the first attempt placed the `api.ts` call before the MFA
guard. `startRuntimeTelemetry` reads `config.APP_ENV` to map `local → development`, which shifted the
read order the existing `api.v1-guard-regression.test.ts` depends on (a `Proxy` that answers "local" to
the _first_ `APP_ENV` read and "production" to every read after, to isolate the payments guard from the
MFA guard) — surfaced immediately as a real test failure, not a false pass. Moving the telemetry call
after both guards restored the original read order and fixed it without touching the test.

## 4. Run

| Gate             | Result                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm typecheck` | ✅ 76/76                                                           |
| `pnpm lint`      | ✅ 76/76                                                           |
| `pnpm test`      | ✅ 76/76 tasks; `@platform/runtime` 29 files / 130 tests (was 127) |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps)            |

## 5. Scope discipline

No architecture change, no new bounded context, no public API change — `startRuntimeTelemetry`'s
signature and `Telemetry`'s shape are unchanged; only call sites were added. No new telemetry engine.
