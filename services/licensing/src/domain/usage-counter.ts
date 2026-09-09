import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import Decimal, { type Decimal as DecimalType } from "decimal.js";
import { LicensingChanged } from "./events/licensing-changed.event";

interface UsageCounterProps {
  readonly tenantRef: string;
  readonly resource: string;
  amount: DecimalType;
  unit: string;
  lastRecordedAt?: Date;
}

/**
 * Event-sourced from `platform.usage.recorded` (ADR-0018 Sprint-5.5 addendum §C, `@platform/usage`)
 * — owns no source data, never generates usage. One counter per `(tenantRef, resource)`.
 *
 * WP-11 (F-07): `amount` is a `Decimal` (decimal.js), not a plain `number`, specifically because
 * `recordUsage` accumulates it across many calls over the counter's lifetime — a JS `number` `+=`
 * is IEEE-754 binary float arithmetic and drifts under repeated fractional addition (e.g.
 * `0.1 + 0.1 + ... ` one thousand times is not exactly `100` in float). `Decimal` arithmetic is
 * exact. The public `amount` getter still returns `number` (via `.toNumber()`) for every existing
 * caller — this is a one-time, final conversion of an already-exact value, not a repeated one, so
 * it does not reintroduce the drift the internal `Decimal` accumulator exists to prevent.
 */
export class UsageCounter extends AggregateRoot<UsageCounterProps> {
  static create(
    id: UniqueEntityId,
    tenantRef: string,
    resource: string,
    eventId: string,
    occurredAt: Date,
  ): UsageCounter {
    const counter = new UsageCounter({ tenantRef, resource, amount: new Decimal(0), unit: "" }, id);
    counter.raise("created", eventId, occurredAt);
    return counter;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    resource: string,
    amount: Decimal.Value,
    unit: string,
    version: number,
    lastRecordedAt?: Date,
  ): UsageCounter {
    return new UsageCounter(
      { tenantRef, resource, amount: new Decimal(amount), unit, lastRecordedAt },
      id,
      version,
    );
  }

  /** Increments the counter from one `platform.usage.recorded` record — idempotency is the caller's job. */
  recordUsage(amount: number, unit: string, occurredAt: Date, eventId: string): void {
    this.props.amount = this.props.amount.plus(amount);
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
    return this.props.amount.toNumber();
  }

  /** The exact decimal string — the mapper's write path uses this, not `.amount`, so persistence never round-trips the accumulated value through a JS `number`. */
  get amountDecimalString(): string {
    return this.props.amount.toFixed(4);
  }

  get unit(): string {
    return this.props.unit;
  }

  get lastRecordedAt(): Date | undefined {
    return this.props.lastRecordedAt;
  }
}
