import { describe, expect, it } from "vitest";
import { InMemoryDeadLetterStore } from "./in-memory-dead-letter-store";

describe("InMemoryDeadLetterStore", () => {
  it("stores dead-lettered entries", async () => {
    const store = new InMemoryDeadLetterStore();
    await store.add({
      messageId: "m1",
      topic: "orders.order.placed.v1",
      value: new Uint8Array([1, 2, 3]),
      headers: {},
      attempts: 3,
      error: "boom",
      failedAt: "2026-06-29T00:00:00.000Z",
    });

    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0]?.messageId).toBe("m1");
    expect(store.snapshot()[0]?.attempts).toBe(3);
  });
});
