import { Entity } from "../entity/entity";
import type { UniqueEntityId } from "../value-object/unique-entity-id";
import type { DomainEvent } from "../events/domain-event";
import { DomainEventCollection } from "../events/domain-event-collection";

/**
 * Consistency boundary and entry point to a cluster of entities. Collects domain events raised
 * by the aggregate (no publishing — dispatch is an infrastructure concern) and carries a
 * `version` for optimistic concurrency (managed by persistence).
 */
export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private readonly _domainEvents = new DomainEventCollection();
  private readonly _version: number;

  protected constructor(props: TProps, id: UniqueEntityId, version = 0) {
    super(props, id);
    this._version = version;
  }

  get version(): number {
    return this._version;
  }

  get domainEvents(): readonly DomainEvent[] {
    return this._domainEvents.asArray();
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.add(event);
  }

  /**
   * Returns the collected events and clears them in one step. Preferred at the dispatch boundary
   * (infrastructure) so events cannot be read and cleared in separate, racy operations.
   */
  pullDomainEvents(): readonly DomainEvent[] {
    const events = this._domainEvents.asArray();
    this._domainEvents.clear();
    return events;
  }
}
