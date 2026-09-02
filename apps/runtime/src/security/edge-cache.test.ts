import { describe, expect, it } from "vitest";
import { EdgeCache } from "./edge-cache";

describe("EdgeCache", () => {
  it("caches per namespace with TTL and expires stale entries", () => {
    let clock = 0;
    const cache = new EdgeCache({ defaultTtlMs: 100, now: () => clock });
    cache.set("threat-intel", "1.2.3.4", { malicious: true });
    expect(cache.get("threat-intel", "1.2.3.4")).toEqual({ malicious: true });
    clock = 150;
    expect(cache.get("threat-intel", "1.2.3.4")).toBeUndefined();
  });

  it("isolates namespaces", () => {
    const cache = new EdgeCache({ now: () => 0 });
    cache.set("policy-fragment", "k", "frag");
    expect(cache.get("registry", "k")).toBeUndefined();
    expect(cache.get("policy-fragment", "k")).toBe("frag");
  });

  it("getOrLoad computes on miss and serves cache on hit", async () => {
    const cache = new EdgeCache({ now: () => 0 });
    let loads = 0;
    const load = async (): Promise<number> => {
      loads += 1;
      return 42;
    };
    expect(await cache.getOrLoad("registry", "k", load)).toBe(42);
    expect(await cache.getOrLoad("registry", "k", load)).toBe(42);
    expect(loads).toBe(1);
  });

  it("invalidates a single key", () => {
    const cache = new EdgeCache({ now: () => 0 });
    cache.set("machine-identity", "svc-1", { active: true });
    cache.invalidate("machine-identity", "svc-1");
    expect(cache.get("machine-identity", "svc-1")).toBeUndefined();
  });

  it("bumps a namespace version to invalidate everything under it", () => {
    const cache = new EdgeCache({ now: () => 0 });
    cache.set("policy-fragment", "a", 1);
    cache.set("policy-fragment", "b", 2);
    cache.bumpVersion("policy-fragment");
    expect(cache.get("policy-fragment", "a")).toBeUndefined();
    expect(cache.get("policy-fragment", "b")).toBeUndefined();
  });

  it("tracks hit/miss stats for the policy_cache_hits metric", () => {
    const cache = new EdgeCache({ now: () => 0 });
    cache.get("registry", "x"); // miss
    cache.set("registry", "x", 1);
    cache.get("registry", "x"); // hit
    expect(cache.stats()).toEqual({ hits: 1, misses: 1 });
  });
});
