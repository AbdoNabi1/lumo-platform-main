import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, Guard, isDomainError, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  ConcurrencyError,
  type DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import { PaymentIntent } from "../domain/payment-intent";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";
import type { Refund } from "../domain/refund";
import { PaymentMethod, PspReference } from "../domain/value-objects/payment-references";
import type { PaymentStatusValue } from "../domain/value-objects/payment-status";
import type { FinancePort, NotificationPort, OrdersPort, PaymentProvider } from "./ports";

export interface PaymentIntentStatusOutput {
  readonly paymentIntentId: string;
  readonly status: string;
}

export interface CreatePaymentIntentLifecycleInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface CreatePaymentIntentLifecycleOutput extends PaymentIntentStatusOutput {
  readonly providerIntentId: string;
  readonly clientHandle?: string;
}

export interface PaymentLifecycleDeps {
  readonly intents: PaymentIntentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly paymentProvider: PaymentProvider;
  readonly ordersPort?: OrdersPort;
  readonly financePort?: FinancePort;
  readonly notifications?: NotificationPort;
}

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.4). `PrismaPaymentIntentRepository.save`
 * throws `ConcurrencyError` when a concurrent writer already advanced the row's `version` — that is
 * expected/recoverable under real concurrency (two replicas racing the same intent), so the whole
 * read-validate-write attempt (fresh `findById`, fresh `remaining()` check) is retried from scratch
 * against the now-current row. Any other error (including a Result-channel domain rejection, which
 * is returned not thrown) propagates immediately — this never masks a genuine business rejection.
 */
async function withConcurrencyRetry<T>(maxAttempts: number, attempt: () => Promise<T>): Promise<T> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || i === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

async function notifyBestEffort(
  deps: PaymentLifecycleDeps,
  intent: PaymentIntent,
  tenantId: string,
): Promise<void> {
  try {
    await deps.ordersPort?.reportPaymentOutcome(intent.orderRef, intent.status.value, tenantId);
    await deps.notifications?.notify(intent.orderRef, intent.status.value, tenantId);
  } catch {
    // Best-effort: a reference-only notification failure never fails the intent's own transition.
  }
}

/**
 * Creates the domain intent and the PSP-side intent (`PaymentProvider.createIntent`).
 *
 * Phase A.13 (Task 5, long-transaction remediation): split into a reserve/PSP-call/settle-on-
 * failure shape, reusing the pattern already proven for capture (A.8) and refund (A.4) — the PSP
 * call used to happen INSIDE the same `unitOfWork.run` transaction that persisted the domain row,
 * holding a PostgreSQL connection/transaction open for the full duration of a real network call
 * (the long-transaction anti-pattern A.7 flagged, never fixed here at the time). Unlike
 * capture/refund, `create` has no caller-supplied id to race on — each call mints a fresh
 * `UniqueEntityId`, so there is no existing-row concurrency to protect against; the reservation
 * exists purely to move the PSP call outside the transaction, not to defend against racing writers.
 *   1. `reserve` — persists the intent at its initial `created` status in its own committed
 *      transaction, BEFORE the PSP is ever called.
 *   2. The PSP call itself, deliberately outside any open transaction.
 *   3. On PSP failure: `settleFailure` moves the now-dangling `created` reservation to its
 *      terminal `cancelled` state (`created -> cancelled` is a legal transition — `payment-
 *      status.ts`; `created` has no direct `-> failed` transition) rather than leaving an
 *      ambiguous row with no PSP counterpart, then the original PSP error is rethrown unchanged
 *      (unrecognized/unhandled — same as before this refactor, and the same shape
 *      `RefundPaymentLifecycle.execute` already uses for its own PSP-failure path).
 * On success nothing further is persisted — `providerIntentId`/`clientHandle` are returned to the
 * caller but were never part of the domain row (no column stores them), so behavior there is
 * unchanged from before this refactor.
 */
export class CreatePaymentIntentLifecycle implements UseCase<
  CreatePaymentIntentLifecycleInput,
  CreatePaymentIntentLifecycleOutput,
  DomainError
> {
  private readonly deps: PaymentLifecycleDeps;

  constructor(deps: PaymentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreatePaymentIntentLifecycleInput,
  ): Promise<Result<CreatePaymentIntentLifecycleOutput, DomainError>> {
    const orderRef = Guard.againstEmpty(input.orderRef, "orderRef");
    if (!orderRef.ok) return err(orderRef.error);
    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const intent = await this.reserve(id, input.orderRef, amount.value, input.tenantId);

    let providerIntent;
    try {
      providerIntent = await this.deps.paymentProvider.createIntent({
        tenantId: input.tenantId,
        orderRef: input.orderRef,
        amountMinor: input.amountMinor,
        currency: input.currency,
        idempotencyKey: `${id.toString()}:create`,
      });
    } catch (error) {
      await this.settleFailure(id, input.tenantId);
      throw error;
    }

    return ok({
      paymentIntentId: id.toString(),
      status: intent.status.value,
      providerIntentId: providerIntent.providerIntentId,
      clientHandle: providerIntent.clientHandle,
    });
  }

  private async reserve(
    id: UniqueEntityId,
    orderRef: string,
    amount: Money,
    tenantId: string,
  ): Promise<PaymentIntent> {
    const intent = PaymentIntent.createIntent(id, orderRef, amount);
    await this.deps.unitOfWork.run(async (tx) => {
      await this.deps.intents.save(intent, tenantId, tx);
    });
    return intent;
  }

  private async settleFailure(id: UniqueEntityId, tenantId: string): Promise<void> {
    await this.deps.unitOfWork.run(async (tx) => {
      const current = await this.deps.intents.findById(id.toString(), tenantId, tx);
      if (current !== null && current.status.value === "created") {
        current.transition("cancelled", this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.intents.save(current, tenantId, tx);
      }
    });
  }
}

export interface PaymentIntentIdInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentId: string;
}

export interface AdvancePaymentInput extends PaymentIntentIdInput {
  readonly toStatus: PaymentStatusValue;
}

/** Generic validated transition — moves a payment intent to any status its current status's transition table allows. */
export class AdvancePayment implements UseCase<
  AdvancePaymentInput,
  PaymentIntentStatusOutput,
  DomainError
> {
  private readonly deps: PaymentLifecycleDeps;

  constructor(deps: PaymentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvancePaymentInput,
  ): Promise<Result<PaymentIntentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PaymentIntentStatusOutput, DomainError>>(async (tx) => {
      const intent = await this.deps.intents.findById(input.paymentIntentId, input.tenantId, tx);
      if (intent === null) {
        return err(new NotFoundError("Payment intent not found"));
      }

      try {
        intent.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.intents.save(intent, input.tenantId, tx);
      await notifyBestEffort(this.deps, intent, input.tenantId);
      return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
    });
  }
}

export interface AuthorizePaymentInput extends PaymentIntentIdInput {
  readonly pspReference: string;
  readonly paymentMethodToken: string;
  readonly paymentMethodBrand?: string;
  readonly authorizedAmountMinor: number;
}

/** Records the PSP's authorization (reference + tokenized method), transitioning to `authorized`. */
export class AuthorizePayment implements UseCase<
  AuthorizePaymentInput,
  PaymentIntentStatusOutput,
  DomainError
> {
  private readonly deps: PaymentLifecycleDeps;

  constructor(deps: PaymentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: AuthorizePaymentInput,
  ): Promise<Result<PaymentIntentStatusOutput, DomainError>> {
    const pspReference = PspReference.create(input.pspReference);
    if (!pspReference.ok) return err(pspReference.error);
    const paymentMethod = PaymentMethod.create(input.paymentMethodToken, input.paymentMethodBrand);
    if (!paymentMethod.ok) return err(paymentMethod.error);

    return this.deps.unitOfWork.run<Result<PaymentIntentStatusOutput, DomainError>>(async (tx) => {
      const intent = await this.deps.intents.findById(input.paymentIntentId, input.tenantId, tx);
      if (intent === null) {
        return err(new NotFoundError("Payment intent not found"));
      }

      // Phase A.11 (Task 1/14): unlike capture/refund, `authorize` had no idempotency protection of
      // its own — it relies entirely on the HTTP-transport `idempotent: true` response-replay cache
      // (`packages/http/src/server.ts`), which does nothing at all when the caller omits the
      // `Idempotency-Key` header. A retry that reaches here a second time for an intent already
      // `authorized` used to fall straight into `intent.authorize()` -> `transition("authorized", ...)`,
      // which throws: `TRANSITIONS` (`payment-status.ts`) has no `authorized -> authorized`
      // self-transition (by design — a self-loop is not a "move"), the same shape as the
      // `RecordWebhook` gap this phase already closed. A retry presenting the IDENTICAL PSP
      // reference/amount is the SAME logical authorization and is a safe no-op; one presenting a
      // DIFFERENT reference or amount is a genuine conflict (a different authorization entirely) and
      // must still be rejected, not silently accepted.
      if (intent.status.value === "authorized") {
        const samePsp = intent.pspReference?.value === pspReference.value.value;
        const sameAmount = intent.authorizedAmount?.amountMinor === input.authorizedAmountMinor;
        if (samePsp && sameAmount) {
          return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
        }
        return err(
          new BusinessRuleError("Payment intent is already authorized with different details"),
        );
      }

      try {
        intent.authorize(
          pspReference.value,
          paymentMethod.value,
          input.authorizedAmountMinor,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.intents.save(intent, input.tenantId, tx);
      return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
    });
  }
}

interface CaptureReservation {
  readonly pspReference: string;
  /** The intent was already `captured` by a prior attempt — the caller must skip the PSP call and `settle()` entirely. */
  readonly alreadyCaptured: boolean;
  readonly status: string;
}

/**
 * Requests capture from the PSP (`PaymentProvider.capture`), then transitions to `captured` —
 * Payments never captures locally.
 *
 * Phase A.8 (capture-concurrency remediation): split into a `reserve`/PSP-call/`settle` shape,
 * reusing the pattern already proven for `RefundPaymentLifecycle` (Phase A.4) — but adapted, not
 * copied: capture has no partial-amount/"remaining capacity" concept (a payment intent is captured
 * once, in full), so unlike refund there is no per-slice reservation amount to validate, only a
 * single durable state transition to commit before the PSP is ever called:
 *   1. `reserve` — durably transitions the intent to `capture_requested` (`PaymentIntent.
 *      requestCapture`) BEFORE any PSP call, in its own committed transaction. Two racing callers
 *      can only make ONE such commit win (`PrismaPaymentIntentRepository.save`'s `version` check);
 *      the loser retries (`withConcurrencyRetry`) against the now-current row and finds it already
 *      `capture_requested` — a RESUME, not a failure (see below).
 *   2. The PSP call itself, deliberately OUTSIDE any open transaction — the prior implementation
 *      called the PSP from inside the same transaction that read+validated+would eventually persist
 *      the capture, holding a DB connection/lock for the full duration of a real network call (the
 *      long-transaction anti-pattern A.7 flagged). The PSP idempotency key (`<intentId>:capture`)
 *      is, and was already, fully deterministic — derived only from the intent id, never a
 *      per-attempt random id — so unlike the pre-A.5 refund bug, this call was never at risk of
 *      presenting the PSP two DIFFERENT identities for one logical capture; this phase's exploit
 *      tests confirm the PSP itself only ever moves money once. What this split actually fixes is:
 *      (a) the transaction is no longer held open for the PSP round-trip, and (b) a crash between a
 *      successful PSP call and this step's commit now leaves the intent at the durable, PSP-webhook-
 *      reconcilable `capture_requested` status (`capture_requested -> captured` IS a legal
 *      transition) instead of silently reverting to `authorized` (`authorized -> captured` is NOT a
 *      legal transition — a webhook arriving after that kind of crash could never repair the state).
 *   3. `settle` — marks the SAME reservation `captured` (idempotent: if a racing settle already got
 *      there first, this is a no-op read, not a second write) and runs the existing best-effort
 *      notify/Finance side effects.
 * A `reserve()` call that finds the intent already `capture_requested` (a RESUME — the previous
 * attempt's reservation committed but its `settle()` never ran, whether from a losing concurrency
 * race, a crash, or a caller retry) does not re-run `requestCapture` (illegal: `capture_requested`
 * has no self-transition) — it re-presents the SAME deterministic PSP identity and proceeds straight
 * to the PSP call again, which is safe for exactly the reason above. This also means a PSP capture
 * failure leaves the intent at `capture_requested`, not reverted to `authorized` — deliberately: a
 * fresh `reserve()` on retry finds it and resumes immediately, so a failure never permanently blocks
 * a legitimate subsequent capture (Task 18), without inventing a new `failed`-capture state this
 * codebase's transition table does not already model a retry path for (`PaymentIntent.markFailed`
 * exists but was, and remains, unused by any use case — reusing it here would additionally require a
 * full `processing`→`authorized` re-authorization before another capture could ever be attempted,
 * a behavior change with no evidence it is wanted, so this fix does not introduce it).
 */
export class CapturePaymentLifecycle implements UseCase<
  PaymentIntentIdInput,
  PaymentIntentStatusOutput,
  DomainError
> {
  private readonly deps: PaymentLifecycleDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: PaymentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: PaymentIntentIdInput,
  ): Promise<Result<PaymentIntentStatusOutput, DomainError>> {
    const reservation = await this.reserve(input.paymentIntentId, input.tenantId);
    if (!reservation.ok) return err(reservation.error);
    const { pspReference, alreadyCaptured, status } = reservation.value;

    if (alreadyCaptured) {
      return ok({ paymentIntentId: input.paymentIntentId, status });
    }

    await this.deps.paymentProvider.capture(pspReference, `${input.paymentIntentId}:capture`);

    return this.settle(input.paymentIntentId, input.tenantId);
  }

  private async reserve(
    paymentIntentId: string,
    tenantId: string,
  ): Promise<Result<CaptureReservation, DomainError>> {
    return withConcurrencyRetry(CapturePaymentLifecycle.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<CaptureReservation, DomainError>>(async (tx) => {
        const intent = await this.deps.intents.findById(paymentIntentId, tenantId, tx);
        if (intent === null) {
          return err(new NotFoundError("Payment intent not found"));
        }
        if (intent.pspReference === undefined) {
          return err(new ValidationError("Cannot capture before authorization", []));
        }

        if (intent.status.value === "captured") {
          return ok({
            pspReference: intent.pspReference.value,
            alreadyCaptured: true,
            status: intent.status.value,
          });
        }
        if (intent.status.value === "capture_requested") {
          // Resume: a prior attempt already durably reserved this capture (losing concurrency
          // race, crash, or caller retry) — no new transition, no new write.
          return ok({
            pspReference: intent.pspReference.value,
            alreadyCaptured: false,
            status: intent.status.value,
          });
        }

        try {
          intent.requestCapture(this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.intents.save(intent, tenantId, tx);
        return ok({
          pspReference: intent.pspReference.value,
          alreadyCaptured: false,
          status: intent.status.value,
        });
      }),
    );
  }

  /**
   * Phase A.9: made accessible (was `private`) so `RecordWebhook` can settle a `captured` PSP
   * webhook event through this EXACT code — Charge creation, best-effort Orders/Notifications,
   * Finance recording, and idempotent-resume safety — rather than duplicating this logic in the
   * webhook use case (see `record-webhook.use-case.ts`'s `CaptureSettlementPort`).
   */
  async settle(
    paymentIntentId: string,
    tenantId: string,
  ): Promise<Result<PaymentIntentStatusOutput, DomainError>> {
    return withConcurrencyRetry(CapturePaymentLifecycle.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<PaymentIntentStatusOutput, DomainError>>(async (tx) => {
        const intent = await this.deps.intents.findById(paymentIntentId, tenantId, tx);
        if (intent === null) {
          return err(new NotFoundError("Payment intent not found"));
        }

        // Phase A.9: `alreadyCaptured` gates BOTH the write and the notify/Finance side effects
        // below — a `settle()` call that finds the intent already `captured` (a losing concurrency
        // retry resuming after the winner committed, a duplicate webhook/retry race, or a plain
        // idempotent replay) must be a pure no-op, not just skip the redundant write while still
        // re-notifying Orders/Notifications and re-posting a Finance ledger entry for money that
        // already settled. Pre-A.9 this guarded only the write, not the side effects below it.
        const alreadyCaptured = intent.status.value === "captured";
        if (!alreadyCaptured) {
          try {
            intent.markCaptured(this.deps.idGenerator.generate(), this.deps.clock.now());
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.intents.save(intent, tenantId, tx);

          await notifyBestEffort(this.deps, intent, tenantId);
          try {
            await this.deps.financePort?.recordPaymentEvent(
              intent.orderRef,
              intent.amount.amountMinor,
              intent.amount.currency,
              "captured",
              tenantId,
            );
          } catch {
            // Best-effort: Finance recording never fails the capture's own result.
          }
        }
        return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
      }),
    );
  }
}

export interface RefundPaymentLifecycleInput extends PaymentIntentIdInput {
  readonly amountMinor: number;
  readonly currency: string;
  /**
   * Stable identity of the LOGICAL refund (Phase A.5, refund-idempotency remediation) — e.g.
   * Returns' `<returnId>:refund`. Optional: omitting it preserves pre-A.5 behavior (a fresh
   * reservation, and thus a fresh PSP idempotency key, on every call). When supplied, a retry of
   * this WHOLE call with the SAME key is safe — see {@link PaymentIntent.requestRefund}.
   */
  readonly idempotencyKey?: string;
}

interface RefundReservation {
  readonly refundId: string;
  readonly pspReference?: string;
  /** The reservation was already `completed` by a prior attempt (idempotency-key resume) — the caller must skip the PSP call and `settle()` entirely. */
  readonly alreadyCompleted: boolean;
  readonly status: string;
}

/**
 * Requests a refund from the PSP (`PaymentProvider.refund`), then completes it domain-side.
 *
 * Phase A.4 (refund-concurrency remediation): split into three steps, each its own committed
 * transaction, so the PSP is only ever called AFTER a durable, optimistic-lock-protected
 * reservation exists — closing A3-02 (two replicas could each pass the `remaining()` check and
 * each call the PSP for real before either's write was checked against the other):
 *   1. `reserve` — validates + durably records a `pending` {@link Refund} (`PaymentIntent.
 *      requestRefund`). Two racing callers can only make ONE such commit win per unit of
 *      `remaining()` capacity (`PrismaPaymentIntentRepository.save`'s `version` check); the loser
 *      retries against the now-current row (`withConcurrencyRetry`) and re-validates against the
 *      already-reduced `remaining()` — so it fails cleanly (409) with NO PSP call ever made, or
 *      succeeds against genuinely-still-available capacity.
 *   2. The PSP call itself, deliberately OUTSIDE any open transaction (a real network call no
 *      longer holds a DB connection for its duration — also fixes the pre-existing long-transaction
 *      anti-pattern).
 *   3. `settle` — marks the SAME reservation `completed` (PSP succeeded) or `failed` (PSP threw,
 *      releasing the reservation back into `remaining()`); on failure the original PSP error is
 *      still rethrown (unchanged external behavior).
 * Phase A.5 (refund-idempotency remediation) closes the gap Phase A.4 left open: a crash between
 * step 2 succeeding and step 3 committing, followed by a caller retry of the whole `execute()`,
 * used to generate a fresh `refundId` (and thus a fresh PSP idempotency key) that the PSP could not
 * dedupe against the first attempt. `RefundPaymentLifecycleInput.idempotencyKey`, when supplied by
 * the caller (Returns passes its own stable `<returnId>:refund`), makes `reserve()` find the
 * EXISTING reservation instead of minting a new one (`PaymentIntent.requestRefund`) — so `refundId`,
 * and therefore the PSP idempotency key, stays the same across a full-request retry, not only
 * across retries of one reservation's settlement step. A reservation already `completed` short-
 * circuits `execute()` before any PSP call. This does NOT make the PSP call itself provably
 * exactly-once end-to-end — it makes every retry present the SAME idempotency identity to the PSP,
 * which is the actual mechanism PSPs use to collapse a retried call into the original one; whether
 * that collapse is perfect is bounded by the PSP's own idempotency guarantee, not by this codebase
 * (see the Phase A.5 report's PSP Semantics section). Callers that omit `idempotencyKey` keep the
 * pre-A.5 behavior (a fresh reservation every call) — additive, not a breaking change.
 */
export class RefundPaymentLifecycle implements UseCase<
  RefundPaymentLifecycleInput,
  PaymentIntentStatusOutput,
  DomainError
> {
  private readonly deps: PaymentLifecycleDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: PaymentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: RefundPaymentLifecycleInput,
  ): Promise<Result<PaymentIntentStatusOutput, DomainError>> {
    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);

    const reservation = await this.reserve(
      input.paymentIntentId,
      input.tenantId,
      amount.value,
      input.idempotencyKey,
    );
    if (!reservation.ok) return err(reservation.error);
    const { refundId, pspReference, alreadyCompleted, status } = reservation.value;

    // Idempotency-key resume of an already-settled reservation (Phase A.5): the PSP was already
    // confirmed by a prior attempt — never call it again under the same identity, and never
    // re-run `settle()` (it would re-emit a `completed` domain event for money that already moved).
    if (alreadyCompleted) {
      return ok({ paymentIntentId: input.paymentIntentId, status });
    }

    if (pspReference === undefined) {
      return this.settle(input.paymentIntentId, input.tenantId, refundId, { succeeded: true });
    }

    try {
      await this.deps.paymentProvider.refund(
        pspReference,
        input.amountMinor,
        `${input.paymentIntentId}:refund:${refundId}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "PSP refund call failed";
      await this.settle(input.paymentIntentId, input.tenantId, refundId, {
        succeeded: false,
        reason,
      });
      throw error;
    }

    return this.settle(input.paymentIntentId, input.tenantId, refundId, { succeeded: true });
  }

  private async reserve(
    paymentIntentId: string,
    tenantId: string,
    amount: Money,
    idempotencyKey?: string,
  ): Promise<Result<RefundReservation, DomainError>> {
    return withConcurrencyRetry(RefundPaymentLifecycle.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<RefundReservation, DomainError>>(async (tx) => {
        const intent = await this.deps.intents.findById(paymentIntentId, tenantId, tx);
        if (intent === null) {
          return err(new NotFoundError("Payment intent not found"));
        }

        let outcome: { readonly refund: Refund; readonly isNew: boolean };
        try {
          outcome = intent.requestRefund(
            amount,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
            idempotencyKey,
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        // Only a genuinely NEW reservation needs persisting — an idempotency-key resume (Phase
        // A.5) returns the exact same already-durable row, unchanged, so writing it again would
        // just churn `version` for no reason.
        if (outcome.isNew) {
          await this.deps.intents.save(intent, tenantId, tx);
        }
        return ok({
          refundId: outcome.refund.id.toString(),
          pspReference: intent.pspReference?.value,
          alreadyCompleted: outcome.refund.status === "completed",
          status: intent.status.value,
        });
      }),
    );
  }

  private async settle(
    paymentIntentId: string,
    tenantId: string,
    refundId: string,
    outcome: { readonly succeeded: true } | { readonly succeeded: false; readonly reason: string },
  ): Promise<Result<PaymentIntentStatusOutput, DomainError>> {
    return withConcurrencyRetry(RefundPaymentLifecycle.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<PaymentIntentStatusOutput, DomainError>>(async (tx) => {
        const intent = await this.deps.intents.findById(paymentIntentId, tenantId, tx);
        if (intent === null) {
          return err(new NotFoundError("Payment intent not found"));
        }

        // Phase A.10 (Task 2): mirrors Capture's Phase A.9 `alreadyCaptured` guard — a settle()
        // call for a refund reservation that is no longer `pending` (a losing concurrency retry
        // resuming after a racing settle() already won, two idempotency-key-resumed callers both
        // reaching settle() for the SAME reservation, or a plain replay) must be a pure no-op: no
        // second write, no second `refund.transitioned` event, no re-notify for money that already
        // moved. Pre-fix this guarded nothing — every settle() call unconditionally re-ran
        // `completeRefund`/`failRefund` and, on success, `notifyBestEffort`.
        const existingRefund = intent.refunds.find((refund) => refund.id.toString() === refundId);
        const alreadySettled = existingRefund !== undefined && existingRefund.status !== "pending";
        if (!alreadySettled) {
          try {
            if (outcome.succeeded) {
              intent.completeRefund(
                refundId,
                this.deps.idGenerator.generate(),
                this.deps.clock.now(),
              );
            } else {
              intent.failRefund(
                refundId,
                this.deps.idGenerator.generate(),
                this.deps.clock.now(),
                outcome.reason,
              );
            }
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }

          await this.deps.intents.save(intent, tenantId, tx);
          if (outcome.succeeded) {
            await notifyBestEffort(this.deps, intent, tenantId);
          }
        }
        return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
      }),
    );
  }
}
