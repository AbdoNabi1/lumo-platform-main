import type { DomainEvent } from "./domain-event";

/** Collection of domain events raised by an aggregate. Owned by an AggregateRoot. */
export class DomainEventCollection {
  private readonly events: DomainEvent[] = [];

  add(event: DomainEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }

  get isEmpty(): boolean {
    return this.events.length === 0;
  }

  get size(): number {
    return this.events.length;
  }

  /** Returns a defensive copy — mutating the result never affects the collection. */
  asArray(): readonly DomainEvent[] {
    return [...this.events];
  }
}
