import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { describe, expect, it, vi } from "vitest";
import { createAdminHttpApi, deploymentScope, type AdminHttpDeps } from "./server";

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

describe("deploymentScope — what the mode decides about the platform tenant", () => {
  it("multi with a deployment tenant: it is the platform tenant and the tenancy pin; legacy keys are refused", () => {
    expect(deploymentScope({ tenantMode: "multi", tenantId: "tenant-local" })).toEqual({
      platformTenantId: "tenant-local",
      legacyStorageKeys: "refuse",
      tenancyPinnedTo: "tenant-local",
    });
  });

  it("multi WITHOUT a deployment tenant: nothing qualifies (fail closed), never 'no restriction'", () => {
    const scope = deploymentScope({ tenantMode: "multi" });
    expect(scope.platformTenantId).toBe("");
    expect(scope.tenancyPinnedTo).toBe("");
    expect(scope.legacyStorageKeys).toBe("refuse");
  });

  it("an explicit override wins, in either mode", () => {
    expect(
      deploymentScope({
        tenantMode: "multi",
        tenantId: "t",
        platformTenantId: "plat",
        legacyStorageKeys: "allow",
      }),
    ).toMatchObject({ platformTenantId: "plat", legacyStorageKeys: "allow" });
  });

  it("single mode: legacy keys stay signable, no pin, no platform tenant", () => {
    expect(deploymentScope({ tenantId: "tenant-local" })).toEqual({
      platformTenantId: undefined,
      legacyStorageKeys: "allow",
      tenancyPinnedTo: undefined,
    });
  });
});
