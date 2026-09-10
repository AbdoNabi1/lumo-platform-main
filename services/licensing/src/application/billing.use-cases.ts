import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError, NotFoundError, isDomainError } from "@platform/utils";
import { Credit } from "../domain/credit";
import { Invoice, type InvoiceLineItem } from "../domain/invoice";
import type { CreditRepository, InvoiceRepository } from "../domain/repositories";
import type { FinanceLedgerPort, PaymentsPort } from "./ports";

export interface BillingDeps {
  readonly invoices: InvoiceRepository;
  readonly credits: CreditRepository;
  readonly payments: PaymentsPort;
  readonly financeLedger: FinanceLedgerPort;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface IdOutput {
  readonly id: string;
}

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8) — `PrismaInvoiceRepository.save` throws
 * `ConcurrencyError` when a concurrent writer already advanced the row's `version`; that is
 * expected/recoverable (two racing collect attempts for the same invoice), so the read-check-write
 * attempt is retried from scratch against the now-current row. Any other error propagates immediately.
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

export interface CreateInvoiceInput {
  readonly tenantRef: string;
  readonly subscriptionRef: string;
  readonly currency: string;
  readonly lineItems: readonly InvoiceLineItem[];
}

/** Creates a draft invoice. */
export class CreateInvoice implements UseCase<CreateInvoiceInput, IdOutput, DomainError> {
  private readonly deps: BillingDeps;

  constructor(deps: BillingDeps) {
    this.deps = deps;
  }

  async execute(input: CreateInvoiceInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const invoice = Invoice.createDraft(
        id,
        input.tenantRef,
        input.subscriptionRef,
        input.currency,
        input.lineItems,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.invoices.save(invoice, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface InvoiceIdInput {
  readonly invoiceId: string;
  readonly tenantId: string;
}

/** Issues a draft invoice. */
export class IssueInvoice implements UseCase<InvoiceIdInput, IdOutput, DomainError> {
  private readonly deps: BillingDeps;

  constructor(deps: BillingDeps) {
    this.deps = deps;
  }

  async execute(input: InvoiceIdInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const invoice = await this.deps.invoices.findById(input.invoiceId, input.tenantId, tx);
      if (invoice === null) return err(new NotFoundError("Invoice not found"));
      try {
        invoice.issue(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.invoices.save(invoice, tx);
      return ok({ id: invoice.id.toString() });
    });
  }
}

interface CollectPrecheck {
  /** Invoice is already `paid` (idempotent resume) — skip the PSP call and return success as-is. */
  readonly alreadyPaid: boolean;
  readonly tenantRef: string;
  readonly total: number;
  readonly currency: string;
  /**
   * Optimistic-lock version at precheck time (Phase A.16 Task 1/2) — the durable correlation point
   * `payments.collect()`'s idempotency key is derived from. See class doc §Idempotency.
   */
  readonly version: number;
}

/**
 * Collects an issued invoice through the Payments port and posts the settled amount to the
 * Finance ledger (ADR-0018 Sprint-5.5 addendum §B) — Licensing never talks to a PSP directly.
 *
 * Phase A.15 (Task 2/3, cross-context transaction-boundary remediation): the PSP `collect()` call
 * and the Finance `postSettlement()` call both used to run INSIDE the same `unitOfWork.run`
 * transaction that read and would eventually persist the invoice, holding a DB connection open for
 * the full duration of two real network round-trips (the same anti-pattern A.4/A.8/A.13.1 already
 * closed for Payments/Returns — A.14 §11 finding #1). Unlike capture/refund, `Invoice`'s status
 * machine (`draft → issued → paid|failed|voided`) has no `collecting`-style intermediate status to
 * durably reserve before the PSP call — adding one would be a schema/business-semantics change this
 * phase's brief explicitly forbids absent a concrete defect requiring it — so this reuses the
 * simpler pattern Returns' `DecideResolution` (A.13.1) established for that exact shape: a
 * precondition check in its own short transaction, the external call(s) OUTSIDE any transaction,
 * then a settle transaction:
 *   1. `precheck` — durably-committed-so-far read: 404s if missing, short-circuits idempotently if
 *      already `paid` (a retry of a call that already succeeded — no second PSP charge), and
 *      rejects (same `BusinessRuleError` shape as before) if not `issued`.
 *   2. The PSP `collect()` call, deliberately outside any open transaction.
 *   3. `settle` — re-reads the invoice (a concurrent racer may have already settled it — resumed as
 *      a no-op, exactly like Capture/Refund's `alreadyCaptured`/`alreadyCompleted` guards), applies
 *      `markPaid`, and commits.
 *   4. `financeLedger.postSettlement()` — ALSO outside any transaction (A.14 flagged it as part of
 *      the same violation, not a separate one). Fixes a latent bug the pre-fix code had here: because
 *      `postSettlement` used to run *before* the transaction committed, a `postSettlement` failure
 *      landed in the `catch` block, which called `invoice.markFailed()` on an in-memory invoice whose
 *      status was already (uncommitted) `paid` — `paid` has NO outgoing transitions
 *      (`TRANSITIONS.paid = []`), so `markFailed()` itself threw, replacing the real error and
 *      aborting the transaction (losing the `markPaid` write entirely, silently reverting a
 *      successfully-collected payment back to `issued`). That is no longer reachable: by the time
 *      `postSettlement` runs here, `markPaid` is already durably committed in its own transaction, so
 *      a ledger-post failure is now treated as best-effort (same convention as
 *      `CapturePaymentLifecycle.settle`'s `financePort?.recordPaymentEvent` in `payment-lifecycle.
 *      use-cases.ts`) — the collection itself is not rolled back or misrepresented for a Finance-side
 *      recording gap.
 * On failure of step 2 (PSP `collect()` throws): `markFailed()` is applied to a freshly re-read
 * invoice in its own transaction — safe because at that point `markPaid` was never reached.
 *
 * IDEMPOTENCY (Phase A.16, Task 1/2 — closes the A.15 §20 residual risk):
 * `payments.collect()` is now called with a deterministic `<invoiceId>:<version>:collect` key
 * (`PaymentsPort.collect`'s new optional 4th parameter — additive, see `ports.ts` doc), mirroring
 * `CapturePaymentLifecycle`'s `<intentId>:capture` (Phase A.8): no new port, no new status, no schema
 * change — `Invoice`'s own id + its ALREADY-EXISTING optimistic-lock `version` (inherited from
 * `AggregateRoot`, present since the aggregate was first created) is the durable local correlation
 * point Task 2 requires to exist BEFORE the PSP is ever called. `precheck()` captures `version` at
 * the same read that validates `issued`, so:
 *   - A retry/crash-recovery/concurrent-racer call that re-enters `execute()` while the invoice is
 *     STILL `issued` (nothing committed yet) reads the SAME `version` and presents the IDENTICAL key
 *     — the PSP is expected to dedupe it (Stripe-style idempotency-key semantics, the same
 *     assumption `CapturePaymentLifecycle` already relies on), so a crash between PSP success and
 *     `settleSuccess()`'s commit, or two racers both passing `precheck()`, no longer risks a second
 *     real charge.
 *   - A GENUINELY NEW collection attempt — the invoice failed (`markFailed`, version N→N+1) and was
 *     later re-issued (`IssueInvoice`, `failed → issued`, version N+1→N+2) — computes a DIFFERENT key
 *     (`version` changed), so a legitimate second attempt (e.g. after the customer fixes a declined
 *     card) is never blocked by a stale key from the failed attempt. This is why `version`, not a
 *     fixed `<invoiceId>:collect` key, was chosen: a fixed key would have permanently wedged retries
 *     after any real decline.
 *
 * RESIDUAL RISK (documented, not eliminated): this is a MITIGATION, not a formal proof — it depends
 * on the real PSP adapter actually honoring the idempotency key (currently `DeferredPaymentsAdapter`
 * throws unconditionally; no real PSP is wired for Licensing yet, so this cannot be verified against
 * a live provider — see PHASE_A16 report §Licensing Findings). `precheck()` is still a plain read
 * with no row lock, so concurrent racers still both physically call `payments.collect()` — the fix
 * makes that call safe (same key ⇒ PSP-side dedupe), it does not prevent the second call from
 * happening.
 */
export class CollectInvoice implements UseCase<InvoiceIdInput, IdOutput, DomainError> {
  private readonly deps: BillingDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: BillingDeps) {
    this.deps = deps;
  }

  async execute(input: InvoiceIdInput): Promise<Result<IdOutput, DomainError>> {
    const precheck = await this.precheck(input.invoiceId, input.tenantId);
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.alreadyPaid) return ok({ id: input.invoiceId });
    const { tenantRef, total, currency, version } = precheck.value;
    const idempotencyKey = `${input.invoiceId}:${version}:collect`;

    let collected: { reference: string };
    try {
      collected = await this.deps.payments.collect(tenantRef, total, currency, idempotencyKey);
    } catch (error) {
      await this.settleFailure(input.invoiceId, input.tenantId);
      throw error;
    }

    const settled = await this.settleSuccess(input.invoiceId, collected.reference, input.tenantId);
    if (!settled.ok) return settled;

    // Phase A.16 (Task 9 sweep finding): only the racer whose settleSuccess() performed the ACTUAL
    // markPaid write posts to Finance — a racer that found the invoice already paid (a no-op resume)
    // must not re-post. Without this guard, two concurrent execute() calls that both pass precheck()
    // (a known, documented residual risk — see class doc) would both reach here and double-post the
    // SAME settlement to the Finance ledger, even though only one of them actually collected payment
    // for real. Mirrors `CapturePaymentLifecycle.settle`'s `if (!alreadyCaptured)` gate on its own
    // best-effort Finance call (Phase A.9).
    if (!settled.value.alreadyPaid) {
      try {
        await this.deps.financeLedger.postSettlement(
          tenantRef,
          total,
          currency,
          collected.reference,
        );
      } catch {
        // Best-effort (see class doc): the collection itself already committed; a ledger-post
        // failure here is a Finance-side reconciliation gap, not a payment failure.
      }
    }

    return ok({ id: input.invoiceId });
  }

  private async precheck(
    invoiceId: string,
    tenantId: string,
  ): Promise<Result<CollectPrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<CollectPrecheck, DomainError>>(async (tx) => {
      const invoice = await this.deps.invoices.findById(invoiceId, tenantId, tx);
      if (invoice === null) return err(new NotFoundError("Invoice not found"));

      const context = {
        tenantRef: invoice.tenantRef,
        total: invoice.total,
        currency: invoice.currency,
        version: invoice.version,
      };
      if (invoice.status === "paid") {
        return ok({ alreadyPaid: true, ...context });
      }
      if (invoice.status !== "issued") {
        return err(
          new BusinessRuleError(`Cannot transition invoice from ${invoice.status} to paid`),
        );
      }
      return ok({ alreadyPaid: false, ...context });
    });
  }

  private async settleSuccess(
    invoiceId: string,
    paymentReference: string,
    tenantId: string,
  ): Promise<Result<IdOutput & { alreadyPaid: boolean }, DomainError>> {
    return withConcurrencyRetry(CollectInvoice.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<IdOutput & { alreadyPaid: boolean }, DomainError>>(
        async (tx) => {
          const invoice = await this.deps.invoices.findById(invoiceId, tenantId, tx);
          if (invoice === null) return err(new NotFoundError("Invoice not found"));

          // `alreadyPaid` distinguishes "this call performed the write" from "a racer already did" —
          // `execute()` uses it to avoid double-posting to Finance (Phase A.16, see call site).
          const alreadyPaid = invoice.status === "paid";
          if (!alreadyPaid) {
            try {
              invoice.markPaid(
                paymentReference,
                this.deps.idGenerator.generate(),
                this.deps.clock.now(),
              );
            } catch (error) {
              if (isDomainError(error)) return err(error);
              throw error;
            }
            await this.deps.invoices.save(invoice, tx);
          }
          return ok({ id: invoice.id.toString(), alreadyPaid });
        },
      ),
    );
  }

  private async settleFailure(invoiceId: string, tenantId: string): Promise<void> {
    await this.deps.unitOfWork.run(async (tx) => {
      const invoice = await this.deps.invoices.findById(invoiceId, tenantId, tx);
      if (invoice !== null && invoice.status === "issued") {
        invoice.markFailed(this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.invoices.save(invoice, tx);
      }
    });
  }
}

export interface GrantCreditInput {
  readonly tenantRef: string;
  readonly amount: number;
  readonly reason: string;
}

/** Grants a billing credit. */
export class GrantCredit implements UseCase<GrantCreditInput, IdOutput, DomainError> {
  private readonly deps: BillingDeps;

  constructor(deps: BillingDeps) {
    this.deps = deps;
  }

  async execute(input: GrantCreditInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const credit = Credit.grant(
        id,
        input.tenantRef,
        input.amount,
        input.reason,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.credits.save(credit, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface CreditIdInput {
  readonly creditId: string;
  readonly tenantId: string;
}

export interface ConsumeCreditInput extends CreditIdInput {
  readonly amount: number;
}

/** Consumes part (or all) of a granted credit. */
export class ConsumeCredit implements UseCase<ConsumeCreditInput, IdOutput, DomainError> {
  private readonly deps: BillingDeps;

  constructor(deps: BillingDeps) {
    this.deps = deps;
  }

  async execute(input: ConsumeCreditInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const credit = await this.deps.credits.findById(input.creditId, input.tenantId, tx);
      if (credit === null) return err(new NotFoundError("Credit not found"));
      try {
        credit.consume(input.amount, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.credits.save(credit, tx);
      return ok({ id: credit.id.toString() });
    });
  }
}

/** Expires a granted credit. */
export class ExpireCredit implements UseCase<CreditIdInput, IdOutput, DomainError> {
  private readonly deps: BillingDeps;

  constructor(deps: BillingDeps) {
    this.deps = deps;
  }

  async execute(input: CreditIdInput): Promise<Result<IdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IdOutput, DomainError>>(async (tx) => {
      const credit = await this.deps.credits.findById(input.creditId, input.tenantId, tx);
      if (credit === null) return err(new NotFoundError("Credit not found"));
      try {
        credit.expire(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.credits.save(credit, tx);
      return ok({ id: credit.id.toString() });
    });
  }
}
