import { Entity, type UniqueEntityId } from "@platform/domain";

export type LoyaltyTransactionKind = "earn" | "spend" | "cashback" | "referral";

interface LoyaltyTransactionProps {
  readonly idempotencyKey: string;
  readonly kind: LoyaltyTransactionKind;
  /** Positive for earn/cashback/referral, negative for spend. */
  readonly pointsDelta: number;
  readonly ref?: string;
  readonly occurredAt: Date;
}

/** An append-only ledger entry for one points movement (retry-safe idempotency trail; never rewritten). */
export class LoyaltyTransaction extends Entity<LoyaltyTransactionProps> {
  static create(
    id: UniqueEntityId,
    idempotencyKey: string,
    kind: LoyaltyTransactionKind,
    pointsDelta: number,
    occurredAt: Date,
    ref?: string,
  ): LoyaltyTransaction {
    return new LoyaltyTransaction({ idempotencyKey, kind, pointsDelta, ref, occurredAt }, id);
  }

  get idempotencyKey(): string {
    return this.props.idempotencyKey;
  }

  get kind(): LoyaltyTransactionKind {
    return this.props.kind;
  }

  get pointsDelta(): number {
    return this.props.pointsDelta;
  }

  get ref(): string | undefined {
    return this.props.ref;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
