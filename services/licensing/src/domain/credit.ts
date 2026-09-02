import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

export type CreditStatus = "granted" | "consumed" | "expired";

interface CreditProps {
  readonly tenantRef: string;
  readonly reason: string;
  amount: number;
  status: CreditStatus;
}

/** A billing credit (ADR-0018 Sprint-5.5 addendum §B) — grant/consume/expire, event-sourced and auditable (ADR-0009). */
export class Credit extends AggregateRoot<CreditProps> {
  static grant(
    id: UniqueEntityId,
    tenantRef: string,
    amount: number,
    reason: string,
    eventId: string,
    occurredAt: Date,
  ): Credit {
    const credit = new Credit({ tenantRef, reason, amount, status: "granted" }, id);
    credit.raise("granted", eventId, occurredAt);
    return credit;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantRef: string,
    amount: number,
    reason: string,
    status: CreditStatus,
    version: number,
  ): Credit {
    return new Credit({ tenantRef, reason, amount, status }, id, version);
  }

  consume(consumeAmount: number, eventId: string, occurredAt: Date): void {
    if (this.props.status !== "granted") {
      throw new BusinessRuleError(`Cannot consume a credit in status ${this.props.status}`);
    }
    if (consumeAmount > this.props.amount) {
      throw new BusinessRuleError("Cannot consume more than the granted credit amount");
    }
    this.props.amount -= consumeAmount;
    this.props.status = this.props.amount === 0 ? "consumed" : "granted";
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
    return this.props.amount;
  }

  get reason(): string {
    return this.props.reason;
  }

  get status(): CreditStatus {
    return this.props.status;
  }
}
