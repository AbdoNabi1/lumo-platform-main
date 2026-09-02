import { describe, expect, it } from "vitest";
import { DomainEvent, type DomainEventProps } from "./domain-event";
import { DomainEventCollection } from "./domain-event-collection";
import { UniqueEntityId } from "../value-object/unique-entity-id";

class ThingCreated extends DomainEvent {
  readonly eventName = "thing.created";

  constructor(props: DomainEventProps) {
    super(props);
  }
}

function makeEvent(eventId = "evt-1"): ThingCreated {
  return new ThingCreated({
    eventId,
    aggregateId: UniqueEntityId.from("agg-1"),
    occurredAt: new Date("2026-06-28T00:00:00.000Z"),
  });
}

describe("DomainEvent", () => {
  it("carries provided metadata deterministically", () => {
    const event = makeEvent();
    expect(event.eventName).toBe("thing.created");
    expect(event.eventId).toBe("evt-1");
    expect(event.aggregateId.value).toBe("agg-1");
    expect(event.occurredAt.toISOString()).toBe("2026-06-28T00:00:00.000Z");
  });
});

describe("DomainEventCollection", () => {
  it("adds, reports size, and clears", () => {
    const collection = new DomainEventCollection();
    expect(collection.isEmpty).toBe(true);
    collection.add(makeEvent("evt-1"));
    collection.add(makeEvent("evt-2"));
    expect(collection.size).toBe(2);
    collection.clear();
    expect(collection.isEmpty).toBe(true);
  });

  it("returns a defensive copy", () => {
    const collection = new DomainEventCollection();
    collection.add(makeEvent());
    const snapshot = collection.asArray();
    collection.clear();
    expect(snapshot).toHaveLength(1);
  });
});
