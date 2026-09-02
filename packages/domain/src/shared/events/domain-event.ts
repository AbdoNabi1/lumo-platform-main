import type { UniqueEntityId } from "../value-object/unique-entity-id";

export interface DomainEventProps {
  readonly eventId: string;
  readonly aggregateId: UniqueEntityId;
  readonly occurredAt: Date;
}

/**
 * An infrastructure-free record that something happened in the domain. All metadata
 * (`eventId`, `occurredAt`) is **supplied** — the domain neither generates ids nor reads the
 * clock, keeping it fully deterministic. There is no bus, outbox, or publishing here.
 */
export abstract class DomainEvent {
  readonly eventId: string;
  readonly aggregateId: UniqueEntityId;
  readonly occurredAt: Date;

  abstract readonly eventName: string;

  protected constructor(props: DomainEventProps) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.occurredAt = props.occurredAt;
  }
}
