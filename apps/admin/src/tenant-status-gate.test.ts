import { describe, expect, it } from "vitest";
import type { TenantAvailability } from "@platform/http";
import { CachedTenantGate } from "./tenant-status-gate";

function harness(initial: TenantAvailability = "active", platformTenantId = "platform") {
  let now = 1_000;
  let status: TenantAvailability = initial;
  const loads: string[] = [];
  const gate = new CachedTenantGate({
    load: async (id) => {
      loads.push(id);
      if (status === ("boom" as TenantAvailability)) throw new Error("db down");
      return status;
    },
    platformTenantId,
    ttlMs: 10_000,
    now: () => now,
  });
  return {
    gate,
    loads,
    set: (s: TenantAvailability | "boom") => {
      status = s as TenantAvailability;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("CachedTenantGate (T10.6): no database read per request, bounded staleness", () => {
  it("reads the status once for many requests inside the TTL", async () => {
    const h = harness();
    for (let i = 0; i < 50; i++) expect(await h.gate.availability("t1")).toBe("active");
    expect(h.loads).toEqual(["t1"]);
  });

  it("collapses concurrent first requests into one read", async () => {
    const h = harness();
    await Promise.all(Array.from({ length: 20 }, () => h.gate.availability("t1")));
    expect(h.loads).toHaveLength(1);
  });

  it("a suspension is observed no later than the TTL", async () => {
    const h = harness();
    expect(await h.gate.availability("t1")).toBe("active");
    h.set("suspended");
    h.advance(9_999);
    expect(await h.gate.availability("t1")).toBe("active"); // still within the documented window
    h.advance(2);
    expect(await h.gate.availability("t1")).toBe("suspended");
  });

  it("invalidate() makes a suspension effective immediately on this instance", async () => {
    const h = harness();
    await h.gate.availability("t1");
    h.set("suspended");
    h.gate.invalidate("t1");
    expect(await h.gate.availability("t1")).toBe("suspended");
  });

  it("does not cache a failed read: it throws, then recovers on the next call", async () => {
    const h = harness();
    h.set("boom");
    await expect(h.gate.availability("t1")).rejects.toThrow("db down");
    h.set("active");
    expect(await h.gate.availability("t1")).toBe("active");
  });

  it("never serves a stale 'active' past the TTL when the store is unreadable", async () => {
    const h = harness();
    await h.gate.availability("t1");
    h.advance(10_001);
    h.set("boom");
    await expect(h.gate.availability("t1")).rejects.toThrow();
  });

  it("the platform tenant is always available and never read", async () => {
    const h = harness("suspended");
    expect(await h.gate.availability("platform")).toBe("active");
    expect(h.loads).toEqual([]);
  });

  it("an empty platform tenant id exempts nothing (fail closed)", async () => {
    const h = harness("suspended", "");
    expect(await h.gate.availability("")).toBe("suspended");
    expect(await h.gate.availability("t1")).toBe("suspended");
  });
});

describe("CachedTenantGate (T10.6): a status read before a change is never cached after it", () => {
  /** A load whose result the test releases by hand, so a suspension can land WHILE a read is in flight. */
  function deferred() {
    const pending: Array<(v: TenantAvailability) => void> = [];
    let loads = 0;
    const gate = new CachedTenantGate({
      load: () => {
        loads += 1;
        return new Promise<TenantAvailability>((resolve) => pending.push(resolve));
      },
      platformTenantId: "platform",
      ttlMs: 10_000,
      now: () => 1_000,
    });
    return { gate, pending, loads: () => loads };
  }

  it("invalidate() during an in-flight read discards that read's (now stale) result", async () => {
    const h = deferred();
    const first = h.gate.availability("t1"); // read begins: the row says "active"
    // The operator suspends t1 and the lifecycle route invalidates, while that read is still open.
    h.gate.invalidate("t1");
    h.pending[0]?.("active"); // the stale read completes AFTER the change
    expect(await first).toBe("active"); // the caller that started it may see it once...
    const next = h.gate.availability("t1"); // ...but it must not have been cached for the next caller
    expect(h.loads()).toBe(2);
    h.pending[1]?.("suspended");
    expect(await next).toBe("suspended");
  });

  it("invalidate() during an in-flight read: a request arriving after it starts a FRESH read", async () => {
    const h = deferred();
    void h.gate.availability("t1");
    h.gate.invalidate("t1");
    void h.gate.availability("t1"); // must not join the stale in-flight read
    expect(h.loads()).toBe(2);
  });

  it("keeps one tenant's status out of another's (t1 suspended, t2 active)", async () => {
    const statuses: Record<string, TenantAvailability> = { t1: "suspended", t2: "active" };
    const gate = new CachedTenantGate({
      load: async (id) => statuses[id] ?? "unknown",
      platformTenantId: "platform",
      ttlMs: 10_000,
      now: () => 1_000,
    });
    expect(await gate.availability("t1")).toBe("suspended");
    expect(await gate.availability("t2")).toBe("active");
    expect(await gate.availability("t1")).toBe("suspended");
  });
});
