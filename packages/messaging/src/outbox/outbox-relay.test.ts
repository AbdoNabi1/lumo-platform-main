import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { InMemoryEventBus } from "../publisher/in-memory-bus";
import { InMemoryEventPublisher } from "../publisher/in-memory-publisher";
import { InMemoryOutboxStore } from "./in-memory-outbox-store";
import type { OutboxEntry } from "./outbox-entry";
import { OutboxRelay } from "./outbox-relay";

const clock: Clock = { now: () => new Date("2026-06-29T00:00:00.000Z") };

function entry(id: string): OutboxEntry {
  return {
    id,
    topic: "orders.order.placed.v1",
    key: "order-1",
    contentType: "application/x-in-memory-json",
    payload: new Uint8Array([1]),
    headers: { messageId: id, type: "orders.order.placed", eventVersion: "1" },
    status: "pending",
    createdAt: "2026-06-29T00:00:00.000Z",
    publishedAt: null,
  };
}

describe("OutboxRelay", () => {
  it("drains pending entries, publishes them, and marks them published", async () => {
    const store = new InMemoryOutboxStore();
    await store.append([entry("m1"), entry("m2")], undefined);

    const bus = new InMemoryEventBus();
    const delivered: string[] = [];
    bus.subscribe("orders.order.placed.v1", async (r) => {
      delivered.push(r.headers.messageId ?? r.key);
    });

    const relay = new OutboxRelay({ store, publisher: new InMemoryEventPublisher(bus), clock });
    const count = await relay.drainOnce();

    expect(count).toBe(2);
    expect(delivered).toEqual(["m1", "m2"]);
    expect(await store.fetchPending(10)).toHaveLength(0);
    expect(store.snapshot().every((e) => e.status === "published")).toBe(true);
  });

  it("returns 0 when there is nothing pending", async () => {
    const relay = new OutboxRelay({
      store: new InMemoryOutboxStore(),
      publisher: new InMemoryEventPublisher(new InMemoryEventBus()),
      clock,
    });
    expect(await relay.drainOnce()).toBe(0);
  });
});
