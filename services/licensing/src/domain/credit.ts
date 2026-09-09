import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import Decimal, { type Decimal as DecimalType } from "decimal.js";
import { LicensingChanged } from "./events/licensing-changed.event";

export type CreditStatus = "granted" | "consumed" | "expired";

interface CreditProps {
  readonly tenantRef: string;
  readonly reason: string;
  amount: DecimalType;
  status: CreditStatus;
}

/**
 * A billing credit (ADR-0018 Sprint-5.5 addendum §B) — grant/consume/expire, event-sourced and
 * auditable (ADR-0009).
 *
 * WP-11 (F-07): `amount` is a `Decimal` (decimal.js) internally, same reasoning as
 * `UsageCounter.amount` — `consume` mutates it over the credit's lifetime (partial consumption
 * across multiple calls), and a plain `number -=` drifts under repeated fractional subtraction.
 * The public `amount` getter still returns `number`, converted once from the exact accumulator.
 */
export class Credit extends AggregateRoot<CreditProps> {
  static grant(
    id: UniqueEntityId,
    tenantRef: string,
    amount: number,
    reason: string,
    eventId: string,
    occurredAt: Date,
  ): Credit {
    const credit = new Credit(
      { tenantRef, reason, amount: new Decimal(amount), status: "granted" },
      id,
    );
    credit.raise("granted", eventId, occurredAt);
    return credit;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    amount: Decimal.Value,
    reason: string,
    status: CreditStatus,
    version: number,
  ): Credit {
    return new Credit({ tenantRef, reason, amount: new Decimal(amount), status }, id, version);
  }

  consume(consumeAmount: number, eventId: string, occurredAt: Date): void {
    if (this.props.status !== "granted") {
      throw new BusinessRuleError(`Cannot consume a credit in status ${this.props.status}`);
    }
    if (new Decimal(consumeAmount).greaterThan(this.props.amount)) {
      throw new BusinessRuleError("Cannot consume more than the granted credit amount");
    }
    this.props.amount = this.props.amount.minus(consumeAmount);
    this.props.status = this.props.amount.isZero() ? "consumed" : "granted";
    this.raise("consumed", eventId, occurredAt);
  }

  expire(eventId: string, occurredAt: Date): void {
    if (this.props.status !== "granted") {
      throw new BusinessRuleError(`Cannot expire a credit in status ${this.props.status}`);
    }
    this.props.status = "expired";
    this.raise("expired", eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: this.props.tenantRef, family: "credit", action },
      ),
    );
  }

  get tenantRef(): string {
    return this.props.tenantRef;
  }

  get amount(): number {
    return this.props.amount.toNumber();
  }

  /** The exact decimal string — the mapper's write path uses this, not `.amount`, so persistence never round-trips the accumulated value through a JS `number`. */
  get amountDecimalString(): string {
    return this.props.amount.toFixed(4);
  }

  get reason(): string {
    return this.props.reason;
  }

  get status(): CreditStatus {
    return this.props.status;
  }
}
