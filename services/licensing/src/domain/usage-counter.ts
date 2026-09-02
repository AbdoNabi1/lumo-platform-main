import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

interface UsageCounterProps {
  readonly tenantRef: string;
  readonly resource: string;
  amount: number;
  unit: string;
  lastRecordedAt?: Date;
}

/**
 * Event-sourced from `platform.usage.recorded` (ADR-0018 Sprint-5.5 addendum §C, `@platform/usage`)
 * — owns no source data, never generates usage. One counter per `(tenantRef, resource)`.
 */
export class UsageCounter extends AggregateRoot<UsageCounterProps> {
  static create(
    id: UniqueEntityId,
    tenantRef: string,
    resource: string,
    eventId: string,
    occurredAt: Date,
  ): UsageCounter {
    const counter = new UsageCounter({ tenantRef, resource, amount: 0, unit: "" }, id);
    counter.raise("created", eventId, occurredAt);
    return counter;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    resource: string,
    amount: number,
    unit: string,
    version: number,
    lastRecordedAt?: Date,
  ): UsageCounter {
    return new UsageCounter({ tenantRef, resource, amount, unit, lastRecordedAt }, id, version);
  }

  /** Increments the counter from one `platform.usage.recorded` record — idempotency is the caller's job. */
  recordUsage(amount: number, unit: string, occurredAt: Date, eventId: string): void {
    this.props.amount += amount;
    this.props.unit = unit;
    this.props.lastRecordedAt = occurredAt;
    this.raise("incremented", eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: `${this.props.tenantRef}:${this.props.resource}`, family: "usage_counter", action },
      ),
    );
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }

  get resource(): string {
    return this.props.resource;
  }

  get amount(): number {
    return this.props.amount;
  }

  get unit(): string {
    return this.props.unit;
  }

  get lastRecordedAt(): Date | undefined {
    return this.props.lastRecordedAt;
  }
}
