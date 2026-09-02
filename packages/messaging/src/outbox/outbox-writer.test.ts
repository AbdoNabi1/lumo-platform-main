import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { DomainEvent, type DomainEventProps, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { EventContext } from "./event-context";
import { InMemoryOutboxStore } from "./in-memory-outbox-store";
import type { IntegrationEventTranslator } from "./integration-event-translator";
import { OutboxWriter } from "./outbox-writer";

class OrderPlaced extends DomainEvent {
  readonly eventName = "order.placed";
  readonly total: number;
  constructor(props: DomainEventProps, total: number) {
    super(props);
    this.total = total;
  }
}

class InternalOnly extends DomainEvent {
  readonly eventName = "order.touched";
  constructor(props: DomainEventProps) {
    super(props);
  }
}

const clock: Clock = { now: () => new Date("2026-06-29T12:00:00.000Z") };

const translator: IntegrationEventTranslator = {
  translate(event) {
    if (event instanceof OrderPlaced) {
      return {
        type: "orders.order.placed",
        eventVersion: 1,
        aggregateType: "order",
        payload: { total: event.total },
      };
    }
    return undefined; // InternalOnly is intentionally not published
  },
};

const context: EventContext = { correlationId: "corr-1", causationId: "cause-1" };
const aggregateId = UniqueEntityId.from("order-1");

function newWriter(store: InMemoryOutboxStore): OutboxWriter {
  return new OutboxWriter({ store, translator, serializer: new InMemoryEventSerializer(), clock });
}

describe("OutboxWriter", () => {
  const placed = new OrderPlaced(
    { eventId: "evt-1", aggregateId, occurredAt: new Date("2026-06-29T11:00:00.000Z") },
    4200,
  );

  it("maps a published domain event to a pending outbox entry", async () => {
    const store = new InMemoryOutboxStore();
    await newWriter(store).write([placed], context, undefined);

    const entry = store.snapshot()[0];
    if (entry === undefined) throw new Error("expected one outbox entry");

    expect(store.snapshot()).toHaveLength(1);
    expect(entry.id).toBe("evt-1"); // messageId = domain eventId (idempotency key)
    expect(entry.topic).toBe("orders.order.placed.v1");
    expect(entry.key).toBe("order-1"); // partition key = aggregateId
    expect(entry.status).toBe("pending");
    expect(entry.publishedAt).toBeNull();
    expect(entry.headers.correlationId).toBe("corr-1");
    expect(entry.headers.causationId).toBe("cause-1");
  });

  it("round-trips the serialized envelope with full metadata", async () => {
    const store = new InMemoryOutboxStore();
    await newWriter(store).write([placed], context, undefined);

    const entry = store.snapshot()[0];
    if (entry === undefined) throw new Error("expected one outbox entry");

    const event = new InMemoryEventSerializer().deserialize<{ total: number }>({
      type: entry.headers.type ?? "",
      eventVersion: Number(entry.headers.eventVersion ?? "0"),
      contentType: entry.contentType,
      data: entry.payload,
    });

    expect(event.messageId).toBe("evt-1");
    expect(event.aggregateId).toBe("order-1");
    expect(event.aggregateType).toBe("order");
    expect(event.occurredAt).toBe("2026-06-29T11:00:00.000Z");
    expect(event.payload.total).toBe(4200);
    expect(event.metadata).toEqual({});
  });

  it("skips domain events with no translation", async () => {
    const store = new InMemoryOutboxStore();
    const internal = new InternalOnly({ eventId: "evt-2", aggregateId, occurredAt: new Date(0) });
    await newWriter(store).write([internal], context, undefined);
    expect(store.snapshot()).toHaveLength(0);
  });
});
