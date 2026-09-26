import { describe, expect, it } from "vitest";
import type { Cache, Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireFeatureRegistry } from "@platform/feature-registry";
import { LicensingEntitlementPort, type LicensingDecider } from "./licensing-entitlement.adapter";
import { wireEntitlement } from "./wire-entitlement";

/**
 * T10.7 — entitlement decisions for two tenants never contaminate each other.
 *
 * A feature DEFINITION is a per-tenant row: `FeatureDefinition` is stored `(tenantId, key)`, every
 * Feature Registry write route registers under the REQUEST's tenant (`feature-registry-routes.ts`),
 * and `FeatureRegistryRepository.findByKey` takes `tenantId` per call. So the port must read the
 * catalog of the tenant being asked about — not the tenant the process was constructed for.
 *
 * Tenant A publishes `ai.copy`; tenant B has it as an unpublished draft; tenant C never registered
 * it. Licensing is a fake that entitles A and B alike (both have a plan) and honours the
 * `featureAvailable` the port derives from the registry — so the only thing that can tell A from B
 * is the registry read, which is exactly the half that used to be pinned.
 */
const clock: Clock = { now: () => new Date("2026-09-26T00:00:00.000Z") };
function ids(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

async function setup() {
  const { featureRegistry } = wireFeatureRegistry({
    serializer: new InMemoryEventSerializer(),
    idGenerator: ids(),
    clock,
  });
  for (const tenantId of ["tenant-a", "tenant-b"]) {
    await featureRegistry.register({ key: "ai.copy", name: "AI Copy", category: "ai", tenantId });
  }
  await featureRegistry.setRequirements({
    key: "ai.copy",
    requirements: { requiredPlans: ["starter"] },
    tenantId: "tenant-a",
  });
  await featureRegistry.advance({ key: "ai.copy", to: "publish", tenantId: "tenant-a" });

  const licensing: LicensingDecider = {
    async checkEntitlement({ tenantRef, featureAvailable }) {
      const hasPlan = tenantRef === "tenant-a" || tenantRef === "tenant-b";
      const allowed = hasPlan && featureAvailable === true;
      return { status: 200, body: { allowed, source: allowed ? "plan" : "no_subscription" } };
    },
  };
  return { featureRegistry, licensing };
}

function sharedKeyspace(): Cache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
    set: async (key, value) => void store.set(key, JSON.parse(JSON.stringify(value))),
    delete: async (key) => void store.delete(key),
    has: async (key) => store.has(key),
  };
}

describe("LicensingEntitlementPort reads the asked-about tenant's catalog (T10.7)", () => {
  it("one shared port instance answers three tenants three different ways", async () => {
    const { featureRegistry, licensing } = await setup();
    const port = new LicensingEntitlementPort({ featureRegistry, licensing });

    const a = await port.check({ tenant: "tenant-a", featureKey: "ai.copy" });
    const b = await port.check({ tenant: "tenant-b", featureKey: "ai.copy" });
    const c = await port.check({ tenant: "tenant-c", featureKey: "ai.copy" });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(false); // registered but not published for B
    expect(b.source).toBe("no_subscription");
    expect(c.allowed).toBe(false);
    expect(c.source).toBe("feature_unknown"); // C never registered it: not A's catalog by proxy
  });

  it("the answer does not depend on which tenant was asked first", async () => {
    const { featureRegistry, licensing } = await setup();
    const port = new LicensingEntitlementPort({ featureRegistry, licensing });

    expect((await port.check({ tenant: "tenant-b", featureKey: "ai.copy" })).allowed).toBe(false);
    expect((await port.check({ tenant: "tenant-a", featureKey: "ai.copy" })).allowed).toBe(true);
    expect((await port.check({ tenant: "tenant-b", featureKey: "ai.copy" })).allowed).toBe(false);
  });
});

describe("wired guard: no cross-tenant contamination through the shared cache (T10.7)", () => {
  it("A's cached allow is never served to B, on the same pod or another one", async () => {
    const { featureRegistry, licensing } = await setup();
    const l2 = sharedKeyspace();
    const podOne = wireEntitlement({ featureRegistry, licensing, cache: l2, clock });
    const podTwo = wireEntitlement({ featureRegistry, licensing, cache: l2, clock });

    const first = await podOne.guard.evaluate({ tenant: "tenant-a", featureKey: "ai.copy" });
    const cached = await podOne.guard.evaluate({ tenant: "tenant-a", featureKey: "ai.copy" });
    expect(first.allowed).toBe(true);
    expect(cached.allowed).toBe(true);

    expect(
      (await podOne.guard.evaluate({ tenant: "tenant-b", featureKey: "ai.copy" })).allowed,
    ).toBe(false);
    expect(
      (await podTwo.guard.evaluate({ tenant: "tenant-b", featureKey: "ai.copy" })).allowed,
    ).toBe(false);
    // Control: the denial above is B's own decision, not a missing-cache artefact — A still hits L2.
    expect(
      (await podTwo.guard.evaluate({ tenant: "tenant-a", featureKey: "ai.copy" })).allowed,
    ).toBe(true);
  });

  it("wireEntitlement no longer takes a tenant: the guard is a process-wide singleton", async () => {
    const { featureRegistry, licensing } = await setup();
    // @ts-expect-error `tenantId` is not part of the wiring deps any more (T10.7)
    const wired = wireEntitlement({ featureRegistry, licensing, tenantId: "tenant-b", clock });
    // A construction-time tenant, if it were still honoured, would answer A's question as B.
    expect(
      (await wired.guard.evaluate({ tenant: "tenant-a", featureKey: "ai.copy" })).allowed,
    ).toBe(true);
  });
});
