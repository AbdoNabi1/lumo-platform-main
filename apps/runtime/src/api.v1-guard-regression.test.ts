import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadRuntimeConfig } from "./config";
import { buildRuntimeCore } from "./composition";
import type { RuntimeConfig } from "./config";

/**
 * V1_FINAL_VERIFICATION.md identified a real coverage gap: the existing MFA guard (C2-4) throws
 * unconditionally outside `local`, so any test that drives `startApi()` with a plain production
 * config always fails on the MFA check first — the payments guard (V-1) is never actually
 * exercised through the real startup path, only through direct calls to its extracted helper
 * function. That meant deleting `assertProductionPaymentProviderConfigured(config.APP_ENV);` from
 * `startApi` would not have failed any test.
 *
 * This file closes that gap without touching any production code: `createAdminHttpApi` is
 * replaced with a spy (the first `vi.mock` in this repository — no existing seam lets a test
 * observe "was the admin HTTP surface ever constructed" any other way without changing `startApi`'s
 * signature, which is out of scope), and a `Proxy` around the config lets the MFA guard's read of
 * `APP_ENV` and the payments guard's read of `APP_ENV` return different values — isolating the
 * payments guard's effect from the MFA guard's, entirely through `startApi()` itself.
 */

const { mockCreateAdminHttpApi } = vi.hoisted(() => ({
  mockCreateAdminHttpApi: vi.fn(async () => ({
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  })),
}));

vi.mock("@platform/admin", () => ({
  createAdminHttpApi: mockCreateAdminHttpApi,
}));

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.lumo.local",
  AUTH_JWKS_URL: "https://auth.lumo.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.lumo.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.lumo.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.lumo.local:4434",
} as NodeJS.ProcessEnv;

describe("V-1 regression: the actual startApi() production path, not the isolated helper", () => {
  beforeEach(() => {
    mockCreateAdminHttpApi.mockClear();
  });

  it("startApi() never reaches createAdminHttpApi() in production while the stub PaymentProvider is active", async () => {
    const { startApi } = await import("./api");
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    const prodConfig = loadRuntimeConfig({
      ...validEnv,
      APP_ENV: "production",
      KETO_READ_URL: "https://keto.lumo.local",
    });

    await expect(startApi(prodConfig, core)).rejects.toThrow();
    expect(mockCreateAdminHttpApi).not.toHaveBeenCalled();
  });

  it("isolates the payments guard from the MFA guard — the payments guard specifically (not MFA) is what blocks createAdminHttpApi, proven through startApi() itself", async () => {
    const { startApi } = await import("./api");
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));
    const baseConfig = loadRuntimeConfig({
      ...validEnv,
      APP_ENV: "production",
      KETO_READ_URL: "https://keto.lumo.local",
    });

    // startApi reads config.APP_ENV exactly twice before createAdminHttpApi: once in the MFA
    // guard's condition, once as the argument to assertProductionPaymentProviderConfigured. This
    // proxy answers "local" to the first read (letting the MFA guard take its permissive branch)
    // and "production" to every read after — so if startApi throws here, it can only be the
    // payments guard doing it, not MFA.
    let appEnvReads = 0;
    const config = new Proxy(baseConfig, {
      get(target, prop, receiver) {
        if (prop === "APP_ENV") {
          appEnvReads += 1;
          return appEnvReads === 1 ? "local" : "production";
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as RuntimeConfig;

    await expect(startApi(config, core)).rejects.toThrow(/PaymentProvider/);
    expect(appEnvReads).toBeGreaterThanOrEqual(2); // proves both guards' reads were observed
    expect(mockCreateAdminHttpApi).not.toHaveBeenCalled();
  });
});
