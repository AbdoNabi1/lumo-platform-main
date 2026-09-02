import { describe, expect, it } from "vitest";
import { InMemoryReadModelStore } from "./in-memory-read-model-store";

describe("InMemoryReadModelStore", () => {
  it("put is idempotent — a second put overwrites in place", async () => {
    const store = new InMemoryReadModelStore();
    await store.put("profit", "2026-07", { netProfitMinor: 100 });
    await store.put("profit", "2026-07", { netProfitMinor: 200 });
    expect(await store.get("profit", "2026-07")).toEqual({ netProfitMinor: 200 });
    expect(await store.list("profit")).toHaveLength(1);
  });

  it("query paginates with a cursor and reports an accurate total", async () => {
    const store = new InMemoryReadModelStore();
    for (let i = 0; i < 5; i += 1) {
      await store.put("profit", `2026-0${i + 1}`, { netProfitMinor: i });
    }

    const page1 = await store.query("profit", { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await store.query("profit", { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(2);

    const page3 = await store.query("profit", { limit: 2, cursor: page2.nextCursor! });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it("query filters by a field on the projected value", async () => {
    const store = new InMemoryReadModelStore();
    await store.put("margin", "a", { period: "2026-07", revenueMinor: 100 });
    await store.put("margin", "b", { period: "2026-08", revenueMinor: 200 });

    const page = await store.query("margin", { filter: { period: "2026-08" } });
    expect(page.items).toEqual([{ period: "2026-08", revenueMinor: 200 }]);
    expect(page.total).toBe(1);
  });

  it("returns an empty page for an unknown model", async () => {
    const store = new InMemoryReadModelStore();
    const page = await store.query("nonexistent", {});
    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it("clamps limit above the 200 ceiling", async () => {
    const store = new InMemoryReadModelStore();
    for (let i = 0; i < 3; i += 1) {
      await store.put("profit", `k${i}`, { i });
    }
    const page = await store.query("profit", { limit: 999 });
    expect(page.items).toHaveLength(3);
  });
});
