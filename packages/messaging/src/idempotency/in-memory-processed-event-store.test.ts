import { describe, expect, it } from "vitest";
import { InMemoryProcessedEventStore } from "./in-memory-processed-event-store";

describe("InMemoryProcessedEventStore", () => {
  it("records and detects processed ids; only the first recordIfNew wins", async () => {
    const store = new InMemoryProcessedEventStore();

    expect(await store.has("m1")).toBe(false);
    expect(await store.recordIfNew("m1", "2026-06-29T00:00:00.000Z")).toBe(true);
    expect(await store.has("m1")).toBe(true);

    expect(await store.recordIfNew("m1", "2026-06-29T01:00:00.000Z")).toBe(false);
    expect(await store.has("m1")).toBe(true);
  });
});
