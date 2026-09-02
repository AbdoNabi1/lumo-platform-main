import { Entity, type Money, type UniqueEntityId } from "@platform/domain";

/**
 * `pending` = reserved against `remaining()` but not yet PSP-confirmed; `completed` = PSP
 * confirmed; `failed` = PSP call failed, reservation released (excluded from `remaining()`).
 * Defaults to `completed` so every pre-existing call site (the legacy synchronous `refund()`,
 * and rehydration of already-completed rows) is unaffected — only the two-phase
 * `RefundPaymentLifecycle` path constructs a `pending` refund explicitly.
 */
export type RefundStatus = "pending" | "completed" | "failed";

interface RefundProps {
  readonly amount: Money;
  readonly occurredAt: Date;
  status: RefundStatus;
  /**
   * Caller-supplied stable identity of the LOGICAL refund (Phase A.5, refund-idempotency
   * remediation) — distinct from `id` (a fresh generated id per genuinely-new reservation).
   * Optional: a refund created without one (every pre-A.5 call site, and the legacy synchronous
   * `refund()`) is simply never found by `PaymentIntent.requestRefund`'s idempotency lookup, so
   * behavior for those callers is unchanged.
   */
  readonly idempotencyKey?: string;
}

/** A refund issued against a captured payment intent (identity by id). */
export class Refund extends Entity<RefundProps> {
  static create(
    id: UniqueEntityId,
    amount: Money,
    occurredAt: Date,
    status: RefundStatus = "completed",
    idempotencyKey?: string,
  ): Refund {
    return new Refund({ amount, occurredAt, status, idempotencyKey }, id);
  }

  get amount(): Money {
    return this.props.amount;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  get status(): RefundStatus {
    return this.props.status;
  }

  get idempotencyKey(): string | undefined {
    return this.props.idempotencyKey;
  }

  /** PSP confirmed the refund — settles the reservation. */
  markCompleted(): void {
    this.props.status = "completed";
  }

  /** PSP call failed — releases the reservation (`remaining()` excludes `failed` refunds). */
  markFailed(): void {
    this.props.status = "failed";
  }
}
