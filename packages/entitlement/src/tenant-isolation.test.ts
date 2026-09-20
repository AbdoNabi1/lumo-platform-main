import { describe, expect, it } from "vitest";
import type { Cache } from "@platform/contracts";
import { EntitlementCache } from "./cache";
import {
  EntitlementGuard,
  type EntitlementDecision,
  type EntitlementPort,
  type EntitlementRequest,
} from "./entitlement-guard";

/**
 * T10.5 case 5 (cache): an entitlement decision populated for tenant A is never served to tenant B.
 *
 * `REDIS_KEY_PREFIX` (`morbeh:`) is ONE global prefix, so the only thing separating two tenants in the
 * shared L2 keyspace is the tenant embedded in `EntitlementCache.key`. Two `EntitlementCache`
 * instances model two pods: each has its own L1 map, so any cross-tenant hit can only come from L2.
 * Layer: application cache key — no RLS anywhere near this.
 */
function sharedKeyspace(): Cache & { readonly keys: () => string[] } {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
    set: async (key, value) => void store.set(key, JSON.parse(JSON.stringify(value))),
    delete: async (key) => void store.delete(key),
    has: async (key) => store.has(key),
    keys: () => [...store.keys()],
  };
}

const allow: EntitlementDecision = { featureKey: "loyalty", allowed: true, source: "subscription" };

describe("entitlement cache tenant isolation (T10.5)", () => {
  it("a decision cached for A through the shared L2 is a miss for B", async () => {
    const l2 = sharedKeyspace();
    const podA = new EntitlementCache({ cache: l2 });
    const podB = new EntitlementCache({ cache: l2 });
    await podA.set("tenant-a", "loyalty", "write", allow);

    // Control: the same tenant on the other pod DOES hit L2 — without this the miss below proves nothing.
    expect(await podB.get("tenant-a", "loyalty", "write")).toEqual(allow);
    expect(await podB.get("tenant-b", "loyalty", "write")).toBeNull();
    expect(l2.keys().every((key) => key.includes("tenant-a"))).toBe(true);
  });

  it("through the guard: A's cached allow does not leak into B's denied request", async () => {
    const l2 = sharedKeyspace();
    const port: EntitlementPort = {
      check: async (request: EntitlementRequest) => ({
        featureKey: request.featureKey,
        allowed: request.tenant === "tenant-a",
        source: "subscription",
      }),
    };
    const guardA = new EntitlementGuard(port, { cache: new EntitlementCache({ cache: l2 }) });
    const guardB = new EntitlementGuard(port, { cache: new EntitlementCache({ cache: l2 }) });

    expect((await guardA.evaluate({ tenant: "tenant-a", featureKey: "loyalty" })).allowed).toBe(
      true,
    );
    expect((await guardA.evaluate({ tenant: "tenant-a", featureKey: "loyalty" })).allowed).toBe(
      true,
    ); // now cached
    expect((await guardB.evaluate({ tenant: "tenant-b", featureKey: "loyalty" })).allowed).toBe(
      false,
    );
  });

  it("invalidating one tenant does not evict another's entries", async () => {
    const l2 = sharedKeyspace();
    const cache = new EntitlementCache({ cache: l2 });
    await cache.set("tenant-a", "loyalty", "write", allow);
    await cache.set("tenant-b", "loyalty", "write", allow);
    await cache.invalidateTenant("tenant-a");
    expect(await new EntitlementCache({ cache: l2 }).get("tenant-b", "loyalty", "write")).toEqual(
      allow,
    );
  });
});
