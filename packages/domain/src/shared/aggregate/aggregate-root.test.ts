import { describe, expect, it } from "vitest";
import { AggregateRoot } from "./aggregate-root";
import { DomainEvent, type DomainEventProps } from "../events/domain-event";
import { UniqueEntityId } from "../value-object/unique-entity-id";

class OrderPlaced extends DomainEvent {
  readonly eventName = "order.placed";

  constructor(props: DomainEventProps) {
    super(props);
  }
}

interface OrderProps {
  total: number;
}

class Order extends AggregateRoot<OrderProps> {
  static create(total: number, id: UniqueEntityId, version = 0): Order {
    return new Order({ total }, id, version);
  }

  place(eventId: string, occurredAt: Date): void {
    this.addDomainEvent(new OrderPlaced({ eventId, aggregateId: this.id, occurredAt }));
  }
}

describe("AggregateRoot", () => {
  it("collects domain events until they are pulled", () => {
    const order = Order.create(100, UniqueEntityId.from("o-1"));
    expect(order.domainEvents).toHaveLength(0);
    order.place("evt-1", new Date("2026-06-28T00:00:00.000Z"));
    expect(order.domainEvents).toHaveLength(1);
    expect(order.domainEvents[0]?.eventName).toBe("order.placed");
    order.pullDomainEvents();
    expect(order.domainEvents).toHaveLength(0);
  });

  it("exposes its version for optimistic concurrency", () => {
    expect(Order.create(1, UniqueEntityId.from("o-2"), 7).version).toBe(7);
  });

  it("returns a copy of the events list", () => {
    const order = Order.create(1, UniqueEntityId.from("o-3"));
    order.place("e", new Date(0));
    const snapshot = order.domainEvents;
    order.pullDomainEvents();
    expect(snapshot).toHaveLength(1);
  });

  it("pullDomainEvents returns the events and clears them atomically", () => {
    const order = Order.create(1, UniqueEntityId.from("o-4"));
    order.place("e-1", new Date(0));
    order.place("e-2", new Date(0));

    const pulled = order.pullDomainEvents();

    expect(pulled).toHaveLength(2);
    expect(order.domainEvents).toHaveLength(0);
  });
});
