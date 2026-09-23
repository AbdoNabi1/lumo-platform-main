import { AggregateRoot, BusinessRuleError, Money, UniqueEntityId } from "@platform/domain";
import { Charge } from "./charge";
import { PaymentCaptured } from "./events/payment-captured.event";
import { PaymentFailed } from "./events/payment-failed.event";
import { PaymentRefunded } from "./events/payment-refunded.event";
import { PaymentTransitioned } from "./events/payment-transitioned.event";
import { PaymentWebhookReceived } from "./events/payment-webhook-received.event";
import { RefundTransitioned, type RefundState } from "./events/refund-transitioned.event";
import {
  PaymentAttempt,
  type PaymentAttemptKind,
  type PaymentAttemptOutcome,
} from "./payment-attempt";
import { Refund } from "./refund";
import {
  canTransitionPayment,
  PaymentStatus,
  type PaymentStatusValue,
} from "./value-objects/payment-status";
import { PspReference, type PaymentMethod } from "./value-objects/payment-references";
import {
  isDirectCaptureProvider,
  type PaymentProviderKey,
} from "./value-objects/payment-provider-key";
import { PspToken } from "./value-objects/psp-token";
import type { Result } from "@platform/types";

function must<T>(result: Result<T, { message: string }>): T {
  if (!result.ok) {
    throw new BusinessRuleError("Invalid PSP token derived at capture time");
  }
  return result.value;
}

interface PaymentIntentProps {
  readonly orderRef: string;
  readonly amount: Money;
  /** The method the shopper selected — fixed at creation; selects the adapter for every later call. */
  readonly provider: PaymentProviderKey;
  /** The provider's id for the charge itself when it differs from `pspReference` (Paymob: the transaction id, learned from the signed callback). */
  providerTransactionRef?: string;
  status: PaymentStatus;
  readonly charges: Charge[];
  readonly refunds: Refund[];
  readonly attempts: PaymentAttempt[];
  pspReference?: PspReference;
  paymentMethod?: PaymentMethod;
  authorizedAmount?: Money;
}

/**
 * Authorises and captures payment for an order (referenced by bare id), then issues refunds.
 * Legacy state machine (kept intact — the saga depends on `payments.payment_intent.captured`):
 * `requires_payment` → `captured` → `refunded`, or `requires_payment` → `failed`. Full Sprint 4.8
 * lifecycle: `created` → `processing` → `authorized` → `capture_requested` → `captured` →
 * `partially_refunded`/`refunded` → `closed`, with `cancelled`/`expired`/retry side paths. One PSP
 * abstracted behind `PaymentProvider` (`@platform/contracts`); raw card data never touches the
 * aggregate (only a {@link PspToken}/{@link PaymentMethod} token).
 */
export class PaymentIntent extends AggregateRoot<PaymentIntentProps> {
  static create(
    id: UniqueEntityId,
    orderRef: string,
    amount: Money,
    provider: PaymentProviderKey,
  ): PaymentIntent {
    return new PaymentIntent(
      {
        orderRef,
        amount,
        provider,
        status: PaymentStatus.requiresPayment(),
        charges: [],
        refunds: [],
        attempts: [],
      },
      id,
    );
  }

  /** Opens an intent on the full Sprint 4.8 lifecycle — starts at `created`, distinct from the legacy `create()`'s `requires_payment`. */
  static createIntent(
    id: UniqueEntityId,
    orderRef: string,
    amount: Money,
    provider: PaymentProviderKey,
  ): PaymentIntent {
    return new PaymentIntent(
      {
        orderRef,
        amount,
        provider,
        status: PaymentStatus.created(),
        charges: [],
        refunds: [],
        attempts: [],
      },
      id,
    );
  }

  /**
   * Rebuilds a persisted intent exactly as stored - no domain events raised, persisted `version`
   * carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    orderRef: string,
    amount: Money,
    status: PaymentStatus,
    charges: readonly Charge[],
    refunds: readonly Refund[],
    version: number,
    extra: {
      readonly provider: PaymentProviderKey;
      readonly providerTransactionRef?: string;
      readonly attempts?: readonly PaymentAttempt[];
      readonly pspReference?: PspReference;
      readonly paymentMethod?: PaymentMethod;
      readonly authorizedAmount?: Money;
    },
  ): PaymentIntent {
    return new PaymentIntent(
      {
        orderRef,
        amount,
        provider: extra.provider,
        providerTransactionRef: extra.providerTransactionRef,
        status,
        charges: [...charges],
        refunds: [...refunds],
        attempts: extra.attempts === undefined ? [] : [...extra.attempts],
        pspReference: extra.pspReference,
        paymentMethod: extra.paymentMethod,
        authorizedAmount: extra.authorizedAmount,
      },
      id,
      version,
    );
  }

  capture(pspToken: PspToken, eventId: string, occurredAt: Date): void {
    if (!this.props.status.isRequiresPayment) {
      throw new BusinessRuleError(`Cannot capture a payment that is ${this.props.status.value}`);
    }
    this.props.charges.push(
      Charge.create(UniqueEntityId.from(eventId), this.props.amount, pspToken, occurredAt),
    );
    this.props.status = PaymentStatus.captured();
    this.addDomainEvent(
      new PaymentCaptured(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderRef: this.props.orderRef,
          amountMinor: this.props.amount.amountMinor,
          currency: this.props.amount.currency,
        },
      ),
    );
  }

  fail(reason: string, eventId: string, occurredAt: Date): void {
    if (!this.props.status.isRequiresPayment) {
      throw new BusinessRuleError(`Cannot fail a payment that is ${this.props.status.value}`);
    }
    this.props.status = PaymentStatus.failed();
    this.addDomainEvent(
      new PaymentFailed(
        { eventId, aggregateId: this.id, occurredAt },
        { orderRef: this.props.orderRef, reason },
      ),
    );
  }

  refund(amount: Money, eventId: string, occurredAt: Date): void {
    if (!this.props.status.isCaptured) {
      throw new BusinessRuleError(`Cannot refund a payment that is ${this.props.status.value}`);
    }
    if (amount.isGreaterThan(this.remaining())) {
      throw new BusinessRuleError("Refund exceeds the captured amount");
    }
    this.props.refunds.push(Refund.create(UniqueEntityId.from(eventId), amount, occurredAt));
    if (this.remaining().isZero()) {
      this.props.status = PaymentStatus.refunded();
    }
    this.addDomainEvent(
      new PaymentRefunded(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderRef: this.props.orderRef,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
        },
      ),
    );
  }

  /** The generic, validated Sprint 4.8 transition — every named method below delegates to this. */
  transition(toStatus: PaymentStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionPayment(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition payment from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = PaymentStatus.from(toStatus);
    this.addDomainEvent(
      new PaymentTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        { orderRef: this.props.orderRef, fromStatus, toStatus },
      ),
    );
  }

  markProcessing(eventId: string, occurredAt: Date): void {
    this.transition("processing", eventId, occurredAt);
  }

  authorize(
    pspReference: PspReference,
    paymentMethod: PaymentMethod,
    authorizedAmountMinor: number,
    eventId: string,
    occurredAt: Date,
  ): void {
    this.transition("authorized", eventId, occurredAt);
    this.props.pspReference = pspReference;
    this.props.paymentMethod = paymentMethod;
    const authorizedAmount = Money.create(authorizedAmountMinor, this.props.amount.currency);
    if (!authorizedAmount.ok) {
      throw new BusinessRuleError("Invalid authorized amount");
    }
    this.props.authorizedAmount = authorizedAmount.value;
    this.recordAttempt("authorize", "succeeded", occurredAt);
  }

  requestCapture(eventId: string, occurredAt: Date): void {
    this.transition("capture_requested", eventId, occurredAt);
  }

  /**
   * Records the captured {@link Charge} (reusing the legacy charge/refund bookkeeping `remaining()` depends on) and transitions to `captured`.
   *
   * For a direct-capture provider (Paymob, cash-on-delivery) it ALSO raises the legacy
   * `PaymentCaptured` event (`payments.payment_intent.captured`) — the only event Orders'
   * `PaymentCapturedConsumer` and Finance's captured consumer subscribe to, and so the only thing
   * that ever drives an order to paid. The lifecycle transition alone raises
   * `payments.intent.captured`, a different wire type nothing subscribes to (see
   * `finance-settlement-backfill.ts`); for Stripe that pre-existing gap is left as it is, but a
   * provider whose ONLY capture signal is this method must not settle silently. `integrationEventId`
   * is the second, distinct event id that needs.
   */
  markCaptured(eventId: string, occurredAt: Date, integrationEventId?: string): void {
    const capturedAmount = this.props.authorizedAmount ?? this.props.amount;
    const tokenValue = this.props.paymentMethod?.token ?? this.props.pspReference?.value ?? eventId;
    const token = must(PspToken.create(tokenValue));
    this.props.charges.push(
      Charge.create(UniqueEntityId.from(eventId), capturedAmount, token, occurredAt),
    );
    this.transition("captured", eventId, occurredAt);
    this.recordAttempt("capture", "succeeded", occurredAt);
    if (this.isDirectCapture) {
      if (integrationEventId === undefined) {
        throw new BusinessRuleError(
          "A direct-capture settlement needs its own integration event id",
        );
      }
      this.addDomainEvent(
        new PaymentCaptured(
          { eventId: integrationEventId, aggregateId: this.id, occurredAt },
          {
            orderRef: this.props.orderRef,
            amountMinor: capturedAmount.amountMinor,
            currency: capturedAmount.currency,
          },
        ),
      );
    }
  }

  /**
   * Records the provider's own id for the payment it just created (Paymob: the order id every signed
   * callback carries; Stripe: the `pi_…` id). Set once — a provider id never silently changes.
   */
  recordProviderIntent(providerIntentId: string): void {
    const reference = PspReference.create(providerIntentId);
    if (!reference.ok) {
      throw new BusinessRuleError("Provider returned an empty intent reference");
    }
    if (this.props.pspReference !== undefined) {
      if (this.props.pspReference.value === providerIntentId) return;
      throw new BusinessRuleError("Payment intent already has a different provider reference");
    }
    this.props.pspReference = reference.value;
  }

  /**
   * Walks a direct-capture intent to `capture_requested`, the only status `markCaptured` may follow,
   * for a provider that has no authorize/capture-request phase of its own (see
   * {@link isDirectCaptureProvider}). The intermediate `processing`/`authorized` statuses are
   * bookkeeping so the existing transition table is respected, not claims about the money: the
   * caller runs this in the SAME transaction that settles the capture, on the strength of a
   * verified signal (a signature-checked callback, or an operator's confirmed cash collection) —
   * never on order or intent creation. A no-op if already at/after `capture_requested`.
   *
   * `providerTransactionRef` (Paymob's transaction id) is recorded for later refunds.
   */
  prepareDirectCapture(
    nextEventId: () => string,
    occurredAt: Date,
    providerTransactionRef?: string,
  ): void {
    if (!this.isDirectCapture) {
      throw new BusinessRuleError(
        `Provider "${this.props.provider}" captures through the authorize/capture lifecycle, not directly`,
      );
    }
    if (providerTransactionRef !== undefined && this.props.providerTransactionRef === undefined) {
      this.props.providerTransactionRef = providerTransactionRef;
    }
    const status = this.props.status.value;
    if (status === "capture_requested" || status === "captured") return;
    if (status === "created") this.transition("processing", nextEventId(), occurredAt);
    if (this.props.status.value === "processing") {
      this.transition("authorized", nextEventId(), occurredAt);
    }
    // Any other starting status (failed, cancelled, expired, refunded, closed…) has no legal path
    // to capture_requested and is rejected by the transition table here.
    this.transition("capture_requested", nextEventId(), occurredAt);
  }

  markFailed(reason: string, eventId: string, occurredAt: Date): void {
    this.transition("failed", eventId, occurredAt);
    this.recordAttempt("capture", "failed", occurredAt, reason);
  }

  cancelAuthorization(eventId: string, occurredAt: Date): void {
    this.transition("cancelled", eventId, occurredAt);
  }

  markExpired(eventId: string, occurredAt: Date): void {
    this.transition("expired", eventId, occurredAt);
  }

  /** Retries a failed intent back into `processing`. */
  retry(eventId: string, occurredAt: Date): void {
    this.transition("processing", eventId, occurredAt);
  }

  close(eventId: string, occurredAt: Date): void {
    this.transition("closed", eventId, occurredAt);
  }

  /**
   * Reserves a refund BEFORE any PSP call: validates the invariant and durably records a
   * `pending` {@link Refund} (via the caller's `save()`) so `remaining()` immediately reflects
   * it. This is the concurrency-safety boundary (Phase A.4): two callers racing this method
   * against the same persisted version can both pass the `remaining()` check only if their reads
   * predate either's commit — but only one's `save()` can win the optimistic-lock (`version`)
   * race, so at most one reservation for a given slice of `remaining()` is ever durably recorded
   * before any PSP call is made. `eventId` doubles as the refund's own id — the caller reuses it
   * to address this exact reservation in `completeRefund`/`failRefund` and as PSP idempotency-key
   * material. Emits `refund.transitioned` (`requested`).
   *
   * Phase A.5 (refund-idempotency remediation): `idempotencyKey`, when supplied, is the STABLE
   * identity of the LOGICAL refund (e.g. Returns' `<returnId>:refund`) — distinct from `eventId`
   * (a fresh id minted per call, used only for a genuinely NEW reservation's domain-event/entity
   * id). A retry of the WHOLE `requestRefund()` call (crash, timeout, at-least-once redelivery)
   * with the SAME `idempotencyKey` finds the EXISTING reservation instead of creating a second one
   * — `isNew: false`, no new domain event, no capacity re-validated/re-consumed — so the PSP
   * idempotency key derived from the reservation id (`RefundPaymentLifecycle`) stays stable across
   * full-request retries too, not only retries of one reservation's settlement step (closes the gap
   * left open by Phase A.4's report, Retry Analysis). Reusing the key with a different amount is
   * rejected (the identity must always describe the same money movement — Task 11 tamper
   * protection). Reusing the key after the prior attempt definitively `failed` is also rejected: a
   * failed PSP attempt must not be silently resurrected under the same identity, and this codebase
   * has no caller that needs an explicit new attempt today (no speculative engineering) — a genuine
   * retry-after-failure would need a new key, by design.
   */
  requestRefund(
    amount: Money,
    eventId: string,
    occurredAt: Date,
    idempotencyKey?: string,
  ): { readonly refund: Refund; readonly isNew: boolean } {
    if (idempotencyKey !== undefined) {
      const existing = this.props.refunds.find((r) => r.idempotencyKey === idempotencyKey);
      if (existing !== undefined) {
        if (!existing.amount.equals(amount)) {
          throw new BusinessRuleError(
            `Refund idempotency key "${idempotencyKey}" was already used for a different amount`,
          );
        }
        if (existing.status === "failed") {
          throw new BusinessRuleError(
            `Refund idempotency key "${idempotencyKey}" already failed — a new attempt requires a new key`,
          );
        }
        return { refund: existing, isNew: false };
      }
    }

    if (amount.isGreaterThan(this.remaining())) {
      throw new BusinessRuleError("Refund exceeds the captured amount");
    }
    const refund = Refund.create(
      UniqueEntityId.from(eventId),
      amount,
      occurredAt,
      "pending",
      idempotencyKey,
    );
    this.props.refunds.push(refund);
    this.addDomainEvent(
      new RefundTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderRef: this.props.orderRef,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          state: "requested",
        },
      ),
    );
    return { refund, isNew: true };
  }

  private findReservedRefund(refundId: string): Refund {
    const refund = this.props.refunds.find((r) => r.id.toString() === refundId);
    if (refund === undefined) {
      throw new BusinessRuleError(`No reserved refund ${refundId} on this payment intent`);
    }
    return refund;
  }

  /** Settles a `pending` reservation after the PSP confirms it — transitions to `partially_refunded`/`refunded`, emits `refund.transitioned` (`completed`). */
  completeRefund(refundId: string, eventId: string, occurredAt: Date): void {
    const refund = this.findReservedRefund(refundId);
    refund.markCompleted();
    this.props.status = this.remaining().isZero()
      ? PaymentStatus.refunded()
      : PaymentStatus.from("partially_refunded");
    this.recordAttempt("refund", "succeeded", occurredAt);
    this.addDomainEvent(
      new RefundTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderRef: this.props.orderRef,
          amountMinor: refund.amount.amountMinor,
          currency: refund.amount.currency,
          state: "completed",
        },
      ),
    );
  }

  /** Releases a `pending` reservation after the PSP call fails — excludes it from `remaining()`, emits `refund.transitioned` (`failed`). Does not change the intent's own status. */
  failRefund(refundId: string, eventId: string, occurredAt: Date, reason: string): void {
    const refund = this.findReservedRefund(refundId);
    refund.markFailed();
    this.recordAttempt("refund", "failed", occurredAt, reason);
    this.addDomainEvent(
      new RefundTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          orderRef: this.props.orderRef,
          amountMinor: refund.amount.amountMinor,
          currency: refund.amount.currency,
          state: "failed",
        },
      ),
    );
  }

  /** Records a PSP webhook receipt (replay-safety is enforced by the application layer's `ProcessedWebhookStore`, before this is ever called twice for the same event). */
  recordWebhook(provider: string, kind: string, eventId: string, occurredAt: Date): void {
    this.recordAttempt("webhook", "succeeded", occurredAt, kind);
    this.addDomainEvent(
      new PaymentWebhookReceived(
        { eventId, aggregateId: this.id, occurredAt },
        { orderRef: this.props.orderRef, provider, kind },
      ),
    );
  }

  /**
   * Captured minus refunded-or-reserved (in the intent's currency). `pending` refunds count here
   * too — that is what makes a reservation (`requestRefund`) durably shrink the refundable
   * capacity for every subsequent reader, before the PSP is ever called (Phase A.4). Only `failed`
   * refunds are excluded (their reservation was released).
   */
  private remaining(): Money {
    const captured = this.props.charges.reduce(
      (acc, charge) => acc.plus(charge.amount),
      Money.zero(this.props.amount.currency),
    );
    return this.props.refunds
      .filter((refund) => refund.status !== "failed")
      .reduce((acc, refund) => acc.minus(refund.amount), captured);
  }

  private recordAttempt(
    kind: PaymentAttemptKind,
    outcome: PaymentAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): void {
    this.props.attempts.push(
      PaymentAttempt.create(
        UniqueEntityId.from(this.id.toString() + this.props.attempts.length),
        kind,
        outcome,
        occurredAt,
        reference,
      ),
    );
  }

  get orderRef(): string {
    return this.props.orderRef;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get status(): PaymentStatus {
    return this.props.status;
  }

  /** Captures against this intent (persisted verbatim). */
  get charges(): readonly Charge[] {
    return this.props.charges;
  }

  /** Refunds issued against this intent (persisted verbatim). */
  get refunds(): readonly Refund[] {
    return this.props.refunds;
  }

  /** The append-only lifecycle-attempt log (persisted verbatim). */
  get attempts(): readonly PaymentAttempt[] {
    return this.props.attempts;
  }

  get provider(): PaymentProviderKey {
    return this.props.provider;
  }

  get providerTransactionRef(): string | undefined {
    return this.props.providerTransactionRef;
  }

  /** True for providers with no authorize/capture-request phase (Paymob, cash-on-delivery). */
  get isDirectCapture(): boolean {
    return isDirectCaptureProvider(this.props.provider);
  }

  get pspReference(): PspReference | undefined {
    return this.props.pspReference;
  }

  get paymentMethod(): PaymentMethod | undefined {
    return this.props.paymentMethod;
  }

  get authorizedAmount(): Money | undefined {
    return this.props.authorizedAmount;
  }
}

export type { RefundState };
