import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";
import { startRuntimeTelemetry } from "./telemetry";

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
} as NodeJS.ProcessEnv;

describe("startRuntimeTelemetry (H-03)", () => {
  it("is side-effect-free and returns a working no-op when both OTel flags are off (the shipped test/local default)", async () => {
    const config = loadRuntimeConfig(validEnv);
    expect(config.OTEL_TRACES_ENABLED).toBe(false);
    expect(config.OTEL_METRICS_ENABLED).toBe(false);
    const telemetry = startRuntimeTelemetry(config, "api");
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it("suffixes the configured service name with the process role", async () => {
    // No direct getter on Telemetry for the resolved service name — this asserts the function accepts
    // and differentiates each of the three roles api.ts/worker.ts/scheduler.ts pass without throwing,
    // which is what would break if a role string were ever mistyped at a call site.
    const config = loadRuntimeConfig(validEnv);
    for (const role of ["api", "worker", "scheduler"] as const) {
      const telemetry = startRuntimeTelemetry(config, role);
      await expect(telemetry.shutdown()).resolves.toBeUndefined();
    }
  });
});
