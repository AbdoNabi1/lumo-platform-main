import { describe, expect, it } from "vitest";
import { InMemoryReadModelStore } from "./in-memory-read-model-store";

const tenantA = "tenant-a";
const tenantB = "tenant-b";

describe("InMemoryReadModelStore", () => {
  it("put is idempotent — a second put overwrites in place", async () => {
    const store = new InMemoryReadModelStore();
    await store.put("profit", "2026-07", { netProfitMinor: 100 }, tenantA);
    await store.put("profit", "2026-07", { netProfitMinor: 200 }, tenantA);
    expect(await store.get("profit", "2026-07", tenantA)).toEqual({ netProfitMinor: 200 });
    expect(await store.list("profit", tenantA)).toHaveLength(1);
  });

  it("query paginates with a cursor and reports an accurate total", async () => {
    const store = new InMemoryReadModelStore();
    for (let i = 0; i < 5; i += 1) {
      await store.put("profit", `2026-0${i + 1}`, { netProfitMinor: i }, tenantA);
    }

    const page1 = await store.query("profit", { limit: 2 }, tenantA);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await store.query("profit", { limit: 2, cursor: page1.nextCursor! }, tenantA);
    expect(page2.items).toHaveLength(2);

    const page3 = await store.query("profit", { limit: 2, cursor: page2.nextCursor! }, tenantA);
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it("query filters by a field on the projected value", async () => {
    const store = new InMemoryReadModelStore();
    await store.put("margin", "a", { period: "2026-07", revenueMinor: 100 }, tenantA);
    await store.put("margin", "b", { period: "2026-08", revenueMinor: 200 }, tenantA);

    const page = await store.query("margin", { filter: { period: "2026-08" } }, tenantA);
    expect(page.items).toEqual([{ period: "2026-08", revenueMinor: 200 }]);
    expect(page.total).toBe(1);
  });

  it("returns an empty page for an unknown model", async () => {
    const store = new InMemoryReadModelStore();
    const page = await store.query("nonexistent", {}, tenantA);
    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it("clamps limit above the 200 ceiling", async () => {
    const store = new InMemoryReadModelStore();
    for (let i = 0; i < 3; i += 1) {
      await store.put("profit", `k${i}`, { i }, tenantA);
    }
    const page = await store.query("profit", { limit: 999 }, tenantA);
    expect(page.items).toHaveLength(3);
  });

  // -- Tenant isolation (ADR-0014, WP-10 T10.3) -------------------------------------------------

  it("does not let tenant A read, list, or query tenant B's read-model rows", async () => {
    const store = new InMemoryReadModelStore();
    await store.put("profit", "2026-07", { netProfitMinor: 100 }, tenantA);
    await store.put("profit", "2026-07", { netProfitMinor: 999 }, tenantB);

    expect(await store.get("profit", "2026-07", tenantA)).toEqual({ netProfitMinor: 100 });
    expect(await store.get("profit", "2026-07", tenantB)).toEqual({ netProfitMinor: 999 });

    expect(await store.list("profit", tenantA)).toEqual([{ netProfitMinor: 100 }]);
    expect(await store.list("profit", tenantB)).toEqual([{ netProfitMinor: 999 }]);

    const pageA = await store.query("profit", {}, tenantA);
    expect(pageA.items).toEqual([{ netProfitMinor: 100 }]);
    expect(pageA.total).toBe(1);
  });
});
