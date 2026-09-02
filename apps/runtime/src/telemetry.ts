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
