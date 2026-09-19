import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { describe, expect, it, vi } from "vitest";
import { createAdminHttpApi, type AdminHttpDeps } from "./server";

const assertMultiTenantReady = vi.hoisted(() => vi.fn());
vi.mock("../tenant-mode-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertMultiTenantReady,
}));

function deps(tenantMode?: "single" | "multi"): AdminHttpDeps {
  return {
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => crypto.randomUUID() },
    clock: { now: () => new Date("2026-09-19T00:00:00.000Z") },
    authenticator: { verify: async () => null },
    rateLimiter: { consume: async () => ({ allowed: true, remaining: 1, retryAfterMs: 0 }) },
    idempotencyKeys: { claim: async () => null },
    responseCache: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      has: async () => false,
    },
    ...(tenantMode === undefined ? {} : { tenantMode }),
  };
}

describe("createAdminHttpApi runs the boot assertion", () => {
  it("under multi mode: hands it the real resolver chain and the composed graph, and a failure aborts boot", async () => {
    assertMultiTenantReady.mockImplementationOnce(() => {
      throw new Error("sentinel: assertion failed");
    });
    await expect(createAdminHttpApi(deps("multi"))).rejects.toThrow("sentinel: assertion failed");
    const [input] = assertMultiTenantReady.mock.calls[0] as [
      { resolvers: readonly unknown[]; graph: Record<string, unknown> },
    ];
    expect(input.resolvers).toHaveLength(2);
    expect(input.graph).toHaveProperty("tenancy");
  });

  it("under single mode: never runs it", async () => {
    assertMultiTenantReady.mockClear();
    const app = await createAdminHttpApi(deps());
    await app.close();
    expect(assertMultiTenantReady).not.toHaveBeenCalled();
  });
});
