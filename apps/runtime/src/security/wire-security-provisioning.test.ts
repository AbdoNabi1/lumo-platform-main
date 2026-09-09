import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as BootstrapSecurityModule from "./bootstrap-security";
import { loadRuntimeConfig } from "../config";
import { buildRuntimeCore } from "../composition";

/**
 * H-04: `bootstrapSecurity` and the three principal-provisioning consumers
 * (`security-provisioning.consumers.ts`) had zero callers repository-wide — the Security principal/
 * role-assignment store was never populated from Identity events. `bootstrapSecurity` is mocked here
 * (not `wireSecurityRuntime`) because it is the one call that performs real Prisma writes; the
 * composition graph itself is lazy (no Docker/Postgres needed to build it — same convention proven
 * throughout `composition.test.ts`).
 */

const { mockBootstrapSecurity } = vi.hoisted(() => ({
  mockBootstrapSecurity: vi.fn(async () => ({
    roles: ["platform-admin", "platform-service"],
    policyKey: "platform-baseline",
    tenantRef: "tenant-local",
  })),
}));

vi.mock("./bootstrap-security", async (importOriginal) => {
  const actual = await importOriginal<typeof BootstrapSecurityModule>();
  return { ...actual, bootstrapSecurity: mockBootstrapSecurity };
});

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

describe("wireSecurityProvisioning (H-04)", () => {
  beforeEach(() => {
    mockBootstrapSecurity.mockClear();
  });

  it("returns null and never touches the store when SECURITY_PRINCIPAL_PROVISIONING is off (default)", async () => {
    const { wireSecurityProvisioning } = await import("./wire-security-provisioning");
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));

    const result = await wireSecurityProvisioning(core);

    expect(result).toBeNull();
    expect(mockBootstrapSecurity).not.toHaveBeenCalled();
  });

  it("provisions the baseline model and registers 3 consumers when the flag is on", async () => {
    const { wireSecurityProvisioning } = await import("./wire-security-provisioning");
    const core = buildRuntimeCore(
      loadRuntimeConfig({ ...validEnv, SECURITY_PRINCIPAL_PROVISIONING: "on" }),
    );

    const result = await wireSecurityProvisioning(core);

    expect(result).not.toBeNull();
    expect(result?.runtimes).toHaveLength(3);
    // built, not started — matches buildPaymentCapturedRuntime's own convention (start() needs the broker)
    expect(result?.runtimes.every((r) => r.isRunning === false)).toBe(true);
    expect(mockBootstrapSecurity).toHaveBeenCalledTimes(1);
    expect(mockBootstrapSecurity).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-local",
      expect.anything(),
    );
  });
});
