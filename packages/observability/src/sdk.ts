import { NodeSDK } from "@opentelemetry/sdk-node";
import type { ObservabilityConfig } from "@platform/config/server";
import { logger } from "@platform/utils";

/** A telemetry lifecycle handle. */
export interface Telemetry {
  start(): void;
  shutdown(): Promise<void>;
}

const NOOP: Telemetry = {
  start() {
    /* tracing and metrics disabled */
  },
  shutdown() {
    return Promise.resolve();
  },
};

/**
 * Creates the OpenTelemetry Node SDK from configuration. The SDK auto-wires OTLP exporters
 * from the standard `OTEL_*` environment variables (service name, exporter selection, endpoint),
 * which keeps a single coordinated OTel dependency set. Returns a no-op when both traces and
 * metrics are disabled (e.g. local/test).
 */
export function createTelemetry(config: ObservabilityConfig): Telemetry {
  if (!config.tracesEnabled && !config.metricsEnabled) {
    return NOOP;
  }

  process.env.OTEL_SERVICE_NAME ??= config.serviceName;
  if (config.otlpEndpoint) {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??= config.otlpEndpoint;
  }
  process.env.OTEL_TRACES_EXPORTER ??= config.tracesEnabled ? "otlp" : "none";
  process.env.OTEL_METRICS_EXPORTER ??= config.metricsEnabled ? "otlp" : "none";

  const sdk = new NodeSDK();

  return {
    start() {
      sdk.start();
      logger.info("telemetry started", {
        service: config.serviceName,
        environment: config.environment,
        traces: config.tracesEnabled,
        metrics: config.metricsEnabled,
      });
    },
    shutdown() {
      return sdk.shutdown();
    },
  };
}
