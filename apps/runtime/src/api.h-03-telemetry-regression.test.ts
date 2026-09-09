import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadRuntimeConfig } from "./config";
import { buildRuntimeCore } from "./composition";

/**
 * H-03: `startRuntimeTelemetry` (apps/runtime/src/telemetry.ts) had zero callers repository-wide —
 * the shipped config enables OTEL_TRACES_ENABLED/OTEL_METRICS_ENABLED, but no trace or metric ever
 * left any process. Proves `startApi()` now starts telemetry for the "api" role, following the same
 * mock-and-inspect convention as the V-1 and H-02 regression tests.
 */

const { mockCreateAdminHttpApi, mockStartRuntimeTelemetry, mockShutdown } = vi.hoisted(() => ({
  mockCreateAdminHttpApi: vi.fn(async () => ({
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  })),
  mockShutdown: vi.fn(async () => undefined),
  mockStartRuntimeTelemetry: vi.fn(),
}));

vi.mock("@platform/admin", () => ({
  createAdminHttpApi: mockCreateAdminHttpApi,
}));

vi.mock("./telemetry", () => ({
  startRuntimeTelemetry: mockStartRuntimeTelemetry,
}));

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

describe("H-03 regression: startApi() starts runtime telemetry", () => {
  beforeEach(() => {
    mockCreateAdminHttpApi.mockClear();
    mockStartRuntimeTelemetry.mockClear();
    mockStartRuntimeTelemetry.mockReturnValue({
      start: vi.fn(),
      shutdown: mockShutdown,
    });
  });

  it('calls startRuntimeTelemetry(config, "api") before serving traffic', async () => {
    const { startApi } = await import("./api");
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    const config = loadRuntimeConfig(validEnv);

    await startApi(config, core);

    expect(mockStartRuntimeTelemetry).toHaveBeenCalledTimes(1);
    expect(mockStartRuntimeTelemetry).toHaveBeenCalledWith(config, "api");
  });
});
