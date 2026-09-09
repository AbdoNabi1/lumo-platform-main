# H-10 — `startRuntimeTelemetry` has no callers; OpenTelemetry never starts in any process

| Field                      | Value                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High                                                                                                                                                                         |
| **Area**                   | Observability                                                                                                                                                                |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                                           |
| **Blocker verdict**        | **True blocker** in combination with H-04 (together: no metrics _and_ no traces). In isolation the function is complete and correct — only the three call sites are missing. |
| **Public contract change** | **No.**                                                                                                                                                                      |

---

## 1. Location

| File                                             | Lines      | What is there                                                                    |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------- |
| `apps/runtime/src/telemetry.ts`                  | 14–27      | `export function startRuntimeTelemetry(config, role): Telemetry` — **0 callers** |
| `apps/runtime/src/api.ts`                        | 1–8, 29–30 | Imports `./config` and `./composition` only                                      |
| `apps/runtime/src/worker.ts`                     | 1–4, 18–27 | Same                                                                             |
| `apps/runtime/src/scheduler.ts`                  | 1–3, 64–67 | Same                                                                             |
| `apps/runtime/src/index.ts`                      | 1–5        | The barrel does **not** re-export `./telemetry`                                  |
| `apps/runtime/src/config.ts`                     | 137–142    | `OTEL_TRACES_ENABLED` / `OTEL_METRICS_ENABLED`, default `false`                  |
| `apps/runtime/src/config.ts`                     | 131–135    | `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`                               |
| `packages/observability/src/sdk.ts`              | —          | `createTelemetry` — the SDK wrapper being called                                 |
| `infrastructure/docker/otel/otel-collector.yaml` | —          | A configured collector with no producer                                          |

---

## 2. Current implementation

The function is complete, correct, and unreachable:

```ts
// apps/runtime/src/telemetry.ts:1-27
import { createTelemetry, type Telemetry } from "@platform/observability";
import type { RuntimeConfig } from "./config";

export type RuntimeRole = "api" | "worker" | "scheduler";

/**
 * Starts the OpenTelemetry Node SDK for one runtime process (P2.0.1 — activation of the EXISTING
 * `@platform/observability` `createTelemetry`/`NodeSDK`; no new telemetry engine). Traces and metrics
 * export over OTLP to the collector when enabled by config. When BOTH are disabled (local/tests),
 * `createTelemetry` returns a no-op, so this stays side-effect-free off the production path and never
 * registers a global provider — which also means no duplicate initialization if a start function runs
 * more than once in a single test process. One SDK per process; the entrypoint owns start + shutdown.
 */
export function startRuntimeTelemetry(config: RuntimeConfig, role: RuntimeRole): Telemetry {
  // `local` is a runtime-only env; OTel's Environment has no `local`, so it maps to `development`.
  const environment = config.APP_ENV === "local" ? "development" : config.APP_ENV;
  const telemetry = createTelemetry({
    serviceName: `${config.OTEL_SERVICE_NAME}-${role}`,
    ...(config.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined
      ? { otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
    tracesEnabled: config.OTEL_TRACES_ENABLED,
    metricsEnabled: config.OTEL_METRICS_ENABLED,
    environment,
  });
  telemetry.start();
  return telemetry;
}
```

Note the last sentence of the docblock: _"One SDK per process; **the entrypoint owns start + shutdown**."_ No entrypoint does.

```
$ git grep -n "startRuntimeTelemetry" -- '*.ts'
apps/runtime/src/telemetry.ts:14:export function startRuntimeTelemetry(...)
```

One hit — its own definition. And the barrel does not re-export it:

```ts
// apps/runtime/src/index.ts — the complete file
export { loadRuntimeConfig, type RuntimeConfig } from "./config";
export { buildPaymentCapturedRuntime, buildRuntimeCore, type RuntimeCore } from "./composition";
export { startApi } from "./api";
export { startWorker } from "./worker";
export { buildJobs, startJobLoop, startScheduler, type ScheduledJob } from "./scheduler";
```

Meanwhile four config fields exist to control it (`config.ts:131-142`), all correctly documented and validated — and read only by the function nothing calls.

---

## 3. Why it is incorrect

`startRuntimeTelemetry` is the OTel activation step (P2.0.1). It was written; the three lines that invoke it were not.

The design is otherwise careful, which makes the omission easy to miss:

- Both flags default to `false`, so _"local/tests never attempt to reach a collector"_.
- `createTelemetry` returns a no-op when both are disabled, so the function is genuinely side-effect-free off the production path.
- The service name is suffixed per role (`morbeh-runtime-api` / `-worker` / `-scheduler`), which is exactly what a multi-process deployment needs.

Because the defaults are `false` and the function no-ops when disabled, the missing call site produces no error, no warning, and no test failure. It is invisible except by grepping for callers.

The same defect shape as **H-02** (dead subtree with live-looking config) and **H-04** (metrics rules citing an absent file). All three are "the last wiring step was not taken", and all three concern observability.

---

## 4. Production impact

**No distributed tracing exists.**

- Setting `OTEL_TRACES_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT=...` in production has **no effect**. An operator would reasonably conclude tracing is active.
- `infrastructure/docker/otel/otel-collector.yaml`, `tempo/tempo.yaml`, and `loki/loki.yaml` are configured and receive nothing from the runtime.
- `packages/http/src/server.ts:113-114` propagates an inbound `traceparent` header onto the response — so trace context is forwarded but never _created_ or _recorded_. Requests carry correlation identifiers with no spans behind them.
- **Combined with H-04, production has neither metrics nor traces.** The only telemetry emitted is the structured per-request log at `packages/http/src/server.ts:118-128`. Debugging a latency or error incident would rely entirely on grepping logs, with no way to follow a request across api → Kafka → worker.
- The security instrumentation that depends on OTel (`apps/runtime/src/security/security-instrumentation.ts`, `security-telemetry-otel.ts`, `security-context-propagation.ts`) is doubly dead: unreachable via H-02, and without an SDK even if reached.

---

## 5. Smallest additive fix

**Three lines per entrypoint, plus shutdown.** This is the second-smallest fix in the audit after H-01.

```ts
// apps/runtime/src/api.ts
import { startRuntimeTelemetry } from "./telemetry";

export async function startApi(config: RuntimeConfig, core?: RuntimeCore): Promise<void> {
  const telemetry = startRuntimeTelemetry(config, "api");   // ← before any client is constructed
  const runtime = core ?? buildRuntimeCore(config);
  ...
  const shutdown = async (): Promise<void> => {
    logger.info("api shutting down");
    await app.close();
    await runtime.redis.disconnect();
    await runtime.prisma.$disconnect();
    await telemetry.shutdown();                              // ← flush pending spans
  };
}
```

Identical shape in `worker.ts` (role `"worker"`) and `scheduler.ts` (role `"scheduler"`).

### Two ordering constraints that matter

1. **Start telemetry before anything else in the entrypoint.** The OTel Node SDK's auto-instrumentation patches modules (`http`, `pg`, `ioredis`, `kafkajs`) at registration time. Calling it after `buildRuntimeCore` — which constructs the Prisma, Redis, and Kafka clients — means those clients are created before instrumentation is installed and may not be traced. Put it on the first line.
2. **Shutdown must flush.** `telemetry.shutdown()` should run in the existing `shutdown` handler. `terminationGracePeriodSeconds: 30` (`infrastructure/k8s/20-deployment-api.yaml:36`) leaves ample room. Verify `Telemetry` exposes `shutdown()` in `packages/observability/src/sdk.ts` before wiring — if it only exposes `start()`, add the shutdown method there first.

### Companion (documentation, no code)

If tracing is intentionally staying off for the first release, say so — `docs/KNOWN_GAPS.md` **G-19** (_"OTel spans/metrics wiring (collector seams exist)"_, P1, status `seam`) is the right place, and its status should move from `seam` to reflect that the activation function now exists but is unmounted.

---

## 6. Public contract impact

**None.**

- `startRuntimeTelemetry` and `RuntimeRole` are already exported from `apps/runtime/src/telemetry.ts`. Calling them changes no signature.
- `createTelemetry` / `Telemetry` (`@platform/observability`) are unchanged.
- `RuntimeConfig` is unchanged — all four `OTEL_*` fields already exist.
- No HTTP route, response shape, event schema, or package export changes.
- Behaviour with the default configuration (`OTEL_TRACES_ENABLED=false`, `OTEL_METRICS_ENABLED=false`) is byte-identical, because `createTelemetry` returns a no-op. **This fix cannot break tests or local development.**

---

## 7. Blocker or intentional deferral?

**Partly deferred, and a true blocker in combination with H-04.**

`docs/KNOWN_GAPS.md` **G-19** legitimately tracks OTel wiring as outstanding, blocked by G-41 (first live boot), status `seam`. So _some_ deferral is documented.

But the deferral has been overtaken by its own resolution. The activation function was written specifically to close G-19 — its docblock says _"P2.0.1 — activation of the EXISTING `@platform/observability` `createTelemetry`/`NodeSDK`"_ — and it is complete, safe-by-default, and side-effect-free when disabled. Only the call sites were missed. The same pattern as H-01 (adapter written, never constructed) and H-04 (metrics file written, never carried onto `main`).

Taken alone, unmounted tracing might be an acceptable first-release gap. Taken with **H-04**, it is not: the platform would go to production with **no metrics and no traces**, monitored only by SLO rules that compute constant perfect availability. That combination removes any ability to detect or diagnose an incident.

**Verdict: true blocker as part of the observability set (H-01, H-04, H-07, H-10).** Individually the cheapest of the four.

---

## 8. How this was verified

- `git grep -n "startRuntimeTelemetry" -- '*.ts'` → **1 hit** (its own definition).
- `apps/runtime/src/telemetry.ts` read in full (27 lines).
- `apps/runtime/src/{api,worker,scheduler,composition,index}.ts` read in full — none imports `./telemetry`.
- `apps/runtime/src/index.ts` (5 lines) read — `./telemetry` is not re-exported.
- `apps/runtime/src/config.ts:126-142` read — the four `OTEL_*` fields and their defaults.
- `git ls-files packages/observability` → `sdk.ts`, `tracing.ts`, `metrics.ts`, `logging.ts`, `errors.ts`; `"test": "echo \"no tests yet\""` per the `pnpm test` run.
- `packages/http/src/server.ts:113-114` read — `traceparent` echoed but no span created.
- `infrastructure/docker/otel/otel-collector.yaml`, `tempo/tempo.yaml` confirmed present.
- No code was modified.
