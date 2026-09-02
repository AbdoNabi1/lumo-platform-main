import { describe, expect, it } from "vitest";
import type { PublishRecord } from "./event-publisher";
import { InMemoryEventBus } from "./in-memory-bus";
import { InMemoryEventPublisher } from "./in-memory-publisher";

function record(topic: string, key: string): PublishRecord {
  return { topic, key, value: new Uint8Array([1]), headers: {} };
}

describe("InMemoryEventPublisher + InMemoryEventBus", () => {
  it("delivers published records to a topic's subscribers in publish order", async () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];
    bus.subscribe("orders.order.placed.v1", async (r) => {
      received.push(r.key);
    });

    await new InMemoryEventPublisher(bus).publishBatch([
      record("orders.order.placed.v1", "o-1"),
      record("orders.order.placed.v1", "o-2"),
    ]);

    expect(received).toEqual(["o-1", "o-2"]);
  });

  it("does not deliver to other topics", async () => {
    const bus = new InMemoryEventBus();
    let count = 0;
    bus.subscribe("a.b.c.v1", async () => {
      count += 1;
    });

    await new InMemoryEventPublisher(bus).publish(record("x.y.z.v1", "k"));
    expect(count).toBe(0);
  });
});
