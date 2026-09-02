import { describe, expect, it } from "vitest";
import type { IntegrationEvent } from "../integration-event";
import { InMemoryEventSerializer } from "./in-memory-event-serializer";

const sample: IntegrationEvent<{ total: number }> = {
  messageId: "0190-aaa",
  type: "orders.order.placed",
  eventVersion: 1,
  aggregateId: "order-1",
  aggregateType: "order",
  occurredAt: "2026-06-29T00:00:00.000Z",
  correlationId: "corr-1",
  causationId: "cause-1",
  payload: { total: 4200 },
  metadata: { source: "checkout" },
};

describe("InMemoryEventSerializer", () => {
  const serializer = new InMemoryEventSerializer();

  it("round-trips an envelope unchanged", () => {
    const serialized = serializer.serialize(sample);
    const restored = serializer.deserialize<{ total: number }>(serialized);
    expect(restored).toEqual(sample);
  });

  it("carries the type, version and content type on the serialized form", () => {
    const serialized = serializer.serialize(sample);
    expect(serialized.type).toBe("orders.order.placed");
    expect(serialized.eventVersion).toBe(1);
    expect(serialized.contentType).toBe("application/x-in-memory-json");
    expect(serialized.data).toBeInstanceOf(Uint8Array);
  });
});
