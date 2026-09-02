import { Entity, type UniqueEntityId } from "@platform/domain";

export type PaymentAttemptKind = "authorize" | "capture" | "refund" | "webhook";
export type PaymentAttemptOutcome = "succeeded" | "failed";

interface PaymentAttemptProps {
  readonly kind: PaymentAttemptKind;
  readonly outcome: PaymentAttemptOutcome;
  readonly reference?: string;
  readonly occurredAt: Date;
}

/** An append-only log entry for a lifecycle step attempt (retry-safe observability trail; never rewritten). */
export class PaymentAttempt extends Entity<PaymentAttemptProps> {
  static create(
    id: UniqueEntityId,
    kind: PaymentAttemptKind,
    outcome: PaymentAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): PaymentAttempt {
    return new PaymentAttempt({ kind, outcome, reference, occurredAt }, id);
  }

  get kind(): PaymentAttemptKind {
    return this.props.kind;
  }

  get outcome(): PaymentAttemptOutcome {
    return this.props.outcome;
  }

  get reference(): string | undefined {
    return this.props.reference;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
