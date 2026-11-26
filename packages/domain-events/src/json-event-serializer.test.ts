import { describe, expect, it } from "vitest";
import type { IntegrationEvent } from "./integration-event";
import { JsonEventSerializer } from "./json-event-serializer";
import type { SerializedEnvelope } from "./serializer";
import { InMemoryEventSerializer } from "./testing/in-memory-event-serializer";

const sample: IntegrationEvent<{ total: number; note: string }> = {
  messageId: "0190-aaa",
  type: "orders.order.placed",
  eventVersion: 2,
  aggregateId: "order-1",
  aggregateType: "order",
  occurredAt: "2026-06-29T00:00:00.000Z",
  correlationId: "corr-1",
  causationId: "cause-1",
  tenantId: "tenant-a",
  producer: "orders",
  payload: { total: 4200, note: "هدية — gift" },
  metadata: { source: "checkout" },
};

describe("JsonEventSerializer", () => {
  const serializer = new JsonEventSerializer();

  it("keeps the frozen wire content type — every outbox row and broker header carries it", () => {
    expect(serializer.contentType).toBe("application/x-in-memory-json");
    expect(serializer.serialize(sample).contentType).toBe("application/x-in-memory-json");
  });

  it("copies the routing descriptors (type, version) from the envelope", () => {
    const serialized = serializer.serialize(sample);
    expect(serialized.type).toBe("orders.order.placed");
    expect(serialized.eventVersion).toBe(2);
  });

  it("encodes the whole envelope as UTF-8 JSON bytes, tenant included", () => {
    const { data } = serializer.serialize(sample);
    expect(data).toBeInstanceOf(Uint8Array);
    const json = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    expect(json).toEqual(sample);
    expect(json["tenantId"]).toBe("tenant-a");
  });

  it("round-trips an envelope unchanged, including non-ASCII payload text", () => {
    const restored = serializer.deserialize<typeof sample.payload>(serializer.serialize(sample));
    expect(restored).toEqual(sample);
    expect(restored.payload.note).toBe("هدية — gift");
  });

  it("is byte-identical to the envelope format the in-memory serializer produces", () => {
    const prod = serializer.serialize(sample);
    const test = new InMemoryEventSerializer().serialize(sample);
    expect(prod).toEqual(test);
    expect(Buffer.from(prod.data).equals(Buffer.from(test.data))).toBe(true);
  });

  it("deserializes bytes written by another producer of the same wire format", () => {
    const fromWire: SerializedEnvelope = {
      type: sample.type,
      eventVersion: sample.eventVersion,
      contentType: "application/x-in-memory-json",
      data: new TextEncoder().encode(JSON.stringify(sample)),
    };
    expect(serializer.deserialize(fromWire)).toEqual(sample);
  });

  it("passes through an envelope that arrives without a tenant, for the consumer to reject", () => {
    const { tenantId: _dropped, ...untenanted } = sample;
    const restored = serializer.deserialize({
      type: sample.type,
      eventVersion: sample.eventVersion,
      contentType: serializer.contentType,
      data: new TextEncoder().encode(JSON.stringify(untenanted)),
    });
    expect((restored as { tenantId?: unknown }).tenantId).toBeUndefined();
  });

  it("throws on bytes that are not JSON rather than returning a partial envelope", () => {
    const garbage: SerializedEnvelope = {
      type: sample.type,
      eventVersion: 1,
      contentType: serializer.contentType,
      data: new TextEncoder().encode("{not json"),
    };
    expect(() => serializer.deserialize(garbage)).toThrow(SyntaxError);
  });
});
