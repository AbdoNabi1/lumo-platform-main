import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrismaAuditTrail } from "@platform/db";
import { loadRuntimeConfig } from "./config";
import { buildRuntimeCore } from "./composition";

/**
 * H-02: `apps/admin/src/http/server.ts` falls back to `InMemoryAuditTrail` whenever
 * `deps.auditTrail` is absent, and `startApi()` never passed one — every authorization decision was
 * recorded to a process-local array, destroyed on restart. The durable `PrismaAuditTrail` adapter,
 * the `platform.audit_events` table, and the 7-year-retention topic already existed; only this wiring
 * was missing. Follows the same mock-and-inspect-the-call convention as
 * `api.v1-guard-regression.test.ts` — the only way to observe what `startApi()` actually passes to
 * `createAdminHttpApi` without changing its signature.
 */

const { mockCreateAdminHttpApi } = vi.hoisted(() => ({
  mockCreateAdminHttpApi: vi.fn(async (_deps: { auditTrail?: unknown }) => ({
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  })),
}));

vi.mock("@platform/admin", () => ({
  createAdminHttpApi: mockCreateAdminHttpApi,
  LoggingSignupEmailAdapter: class {
    async sendCompleteAccountEmail() {
      return undefined;
    }
    async sendAlreadyRegisteredEmail() {
      return undefined;
    }
  },
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

describe("H-02 regression: startApi() wires a durable audit trail", () => {
  beforeEach(() => {
    mockCreateAdminHttpApi.mockClear();
  });

  it("passes a PrismaAuditTrail to createAdminHttpApi instead of leaving it to the InMemoryAuditTrail fallback", async () => {
    const { startApi } = await import("./api");
    const core = buildRuntimeCore(loadRuntimeConfig(validEnv));

    await startApi(loadRuntimeConfig(validEnv), core);

    expect(mockCreateAdminHttpApi).toHaveBeenCalledTimes(1);
    const [deps] = mockCreateAdminHttpApi.mock.calls[0] ?? [];
    expect(deps?.auditTrail).toBeInstanceOf(PrismaAuditTrail);
  });
});
