import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  AuthenticationError,
  ConcurrencyError,
  type DomainError,
  type Logger,
  NotFoundError,
  isDomainError,
} from "@platform/utils";
import { BILLING_PROVIDER, BillingPaymentMethod } from "../domain/billing-payment-method";
import type { BillingPaymentMethodRepository, InvoiceRepository } from "../domain/repositories";
import type {
  BillingTokenSealer,
  BillingTransactionCallbackVerifier,
  CardEnrolmentPort,
  CardTokenCallbackVerifier,
  FinanceLedgerPort,
} from "./ports";

export interface PaymentMethodDeps {
  readonly methods: BillingPaymentMethodRepository;
  readonly invoices: InvoiceRepository;
  readonly sealer: BillingTokenSealer;
  readonly enrolment: CardEnrolmentPort;
  readonly cardTokenVerifier: CardTokenCallbackVerifier;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface BeginCardEnrolmentInput {
  readonly invoiceId: string;
  readonly tenantId: string;
}

export interface BeginCardEnrolmentOutput {
  readonly paymentMethodId: string;
  readonly providerOrderId: string;
  readonly checkoutUrl: string;
}

/**
 * Step 1 of the flow: the merchant pays an ISSUED invoice interactively (a normal 3DS checkout on
 * Morbeh's own PSP account), which is the only thing that makes the PSP issue a card token. The
 * amount and currency are READ from the invoice — never supplied by a caller. The PSP's order id is
 * recorded against the merchant on a `pending` method, because it is the only SIGNED value the token
 * callback carries that we can correlate on.
 */
export class BeginCardEnrolment implements UseCase<
  BeginCardEnrolmentInput,
  BeginCardEnrolmentOutput,
  DomainError
> {
  private readonly deps: PaymentMethodDeps;

  constructor(deps: PaymentMethodDeps) {
    this.deps = deps;
  }

  async execute(
    input: BeginCardEnrolmentInput,
  ): Promise<Result<BeginCardEnrolmentOutput, DomainError>> {
    const invoice = await this.deps.invoices.findById(input.invoiceId, input.tenantId);
    if (invoice === null) return err(new NotFoundError("Invoice not found"));
    if (invoice.status !== "issued") {
      return err(new BusinessRuleError(`Cannot start a payment for a ${invoice.status} invoice`));
    }
    // The PSP call is outside any transaction (the same rule `CollectInvoice` follows).
    const checkout = await this.deps.enrolment.startCheckout({
      tenantRef: invoice.tenantRef,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
      idempotencyKey: `${input.invoiceId}:${invoice.version}:enrol`,
    });
    const method = BillingPaymentMethod.begin(
      this.deps.idGenerator.generate(),
      invoice.tenantRef,
      BILLING_PROVIDER,
      checkout.providerOrderId,
      input.invoiceId,
      this.deps.clock.now(),
    );
    await this.deps.unitOfWork.run(async (tx) => {
      await this.deps.methods.save(method, input.tenantId, tx);
    });
    return ok({
      paymentMethodId: method.id,
      providerOrderId: checkout.providerOrderId,
      checkoutUrl: checkout.checkoutUrl,
    });
  }
}

export interface RecordCardTokenInput {
  readonly rawBody: Uint8Array;
  readonly signature: string;
  /** The platform tenant scope. The controller pins it; a caller cannot choose a merchant scope. */
  readonly tenantId: string;
}

export interface RecordCardTokenOutput {
  readonly paymentMethodId: string;
  readonly status: "active";
}

/**
 * Step 2: the PSP's card-token callback. It is verified against Morbeh's OWN billing account secret
 * by the injected verifier (the token callback has its own signing scheme); only then is the token
 * correlated — by the SIGNED order id — to a `pending` enrolment, sealed, and stored against that
 * merchant. A callback for an order nobody enrolled stores nothing; a redelivery of the same token is
 * a no-op; a newer card revokes the previous one, so a merchant has at most one active method.
 */
export class RecordCardToken implements UseCase<
  RecordCardTokenInput,
  RecordCardTokenOutput,
  DomainError
> {
  private readonly deps: PaymentMethodDeps;

  constructor(deps: PaymentMethodDeps) {
    this.deps = deps;
  }

  async execute(input: RecordCardTokenInput): Promise<Result<RecordCardTokenOutput, DomainError>> {
    const verified = this.deps.cardTokenVerifier.verify(input.rawBody, input.signature);
    if (verified === null) {
      return err(new AuthenticationError("Card-token callback signature verification failed"));
    }

    const pending = await this.deps.methods.findByProviderOrder(
      BILLING_PROVIDER,
      verified.providerOrderId,
      input.tenantId,
    );
    if (pending === null) {
      return err(new NotFoundError("No card enrolment is waiting on this order"));
    }
    // Sealed before the transaction: nothing here holds a DB connection across the vault.
    const sealedToken = await this.deps.sealer.seal(pending.tenantRef, verified.token);

    return this.deps.unitOfWork.run<Result<RecordCardTokenOutput, DomainError>>(async (tx) => {
      const method = await this.deps.methods.findByProviderOrder(
        BILLING_PROVIDER,
        verified.providerOrderId,
        input.tenantId,
        tx,
      );
      if (method === null)
        return err(new NotFoundError("No card enrolment is waiting on this order"));
      if (method.status === "active" && method.tokenId === verified.tokenId) {
        return ok({ paymentMethodId: method.id, status: "active" });
      }
      try {
        const now = this.deps.clock.now();
        const previous = await this.deps.methods.findActiveByTenantRef(
          method.tenantRef,
          input.tenantId,
          tx,
        );
        if (previous !== null && previous.id !== method.id) {
          previous.revoke(now);
          await this.deps.methods.save(previous, input.tenantId, tx);
        }
        method.activate(
          {
            tokenId: verified.tokenId,
            sealedToken,
            maskedPan: verified.maskedPan,
            cardSubtype: verified.cardSubtype,
          },
          now,
        );
        await this.deps.methods.save(method, input.tenantId, tx);
        return ok({ paymentMethodId: method.id, status: "active" });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}

export interface RevokeBillingPaymentMethodInput {
  readonly tenantRef: string;
  readonly tenantId: string;
}

/** Removes the merchant's active card (a platform-operator action): the next renewal then fails visibly. */
export class RevokeBillingPaymentMethod implements UseCase<
  RevokeBillingPaymentMethodInput,
  { readonly revoked: boolean },
  DomainError
> {
  private readonly deps: PaymentMethodDeps;

  constructor(deps: PaymentMethodDeps) {
    this.deps = deps;
  }

  async execute(
    input: RevokeBillingPaymentMethodInput,
  ): Promise<Result<{ readonly revoked: boolean }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ readonly revoked: boolean }, DomainError>>(
      async (tx) => {
        const method = await this.deps.methods.findActiveByTenantRef(
          input.tenantRef,
          input.tenantId,
          tx,
        );
        if (method === null) return ok({ revoked: false });
        method.revoke(this.deps.clock.now());
        await this.deps.methods.save(method, input.tenantId, tx);
        return ok({ revoked: true });
      },
    );
  }
}

export interface RecordInvoiceTransactionInput {
  readonly rawBody: Uint8Array;
  readonly signature: string;
  /** The platform tenant scope. The controller pins it; a caller cannot choose a merchant scope. */
  readonly tenantId: string;
}

/**
 * What actually happened to a VERIFIED callback. Every branch but a bad signature returns one of
 * these with `ok` (200) — a verified callback the invoice cannot or need not accept is still
 * acknowledged, never a 4xx/5xx that would make Paymob retry the same body forever.
 */
export type RecordInvoiceTransactionOutcome =
  "paid" | "already_paid" | "ignored" | "no_enrolment" | "amount_mismatch" | "currency_mismatch";

export interface RecordInvoiceTransactionOutput {
  readonly outcome: RecordInvoiceTransactionOutcome;
}

export interface RecordInvoiceTransactionDeps {
  readonly methods: BillingPaymentMethodRepository;
  readonly invoices: InvoiceRepository;
  readonly financeLedger: FinanceLedgerPort;
  readonly transactionVerifier: BillingTransactionCallbackVerifier;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * G-74 (8): Morbeh's billing TRANSACTION callback — the PSP's confirmation that the merchant's
 * FIRST invoice (paid interactively via `BeginCardEnrolment`) actually settled. Without this, an
 * operator had to mark that invoice `paid` by hand; every invoice after it already settles itself
 * through `CollectInvoice`'s synchronous MIT response (T14.5).
 *
 * SECURITY (D-071): correlates on the SIGNED `order.id` only, via
 * `BillingPaymentMethodRepository.findByProviderOrder` — never on `special_reference`, the
 * unsigned field Paymob echoes `BeginCardEnrolment`'s `<invoiceId>:<version>:enrol` idempotency key
 * back as (`paymob-payment-provider.ts`). `special_reference` is NOT among the 20 fields the
 * transaction callback signs (`packages/psp-paymob/src/webhook-signature.ts`); trusting it would
 * let anyone holding one valid billing callback replay it with that field rewritten to settle a
 * DIFFERENT merchant's invoice. The signed order id resolves to a `BillingPaymentMethod` row, whose
 * `invoiceRef` (recorded at `BeginCardEnrolment` time) is the only invoice this callback may settle.
 */
export class RecordInvoiceTransaction implements UseCase<
  RecordInvoiceTransactionInput,
  RecordInvoiceTransactionOutput,
  DomainError
> {
  private static readonly MAX_CONCURRENCY_RETRIES = 5;
  private readonly deps: RecordInvoiceTransactionDeps;

  constructor(deps: RecordInvoiceTransactionDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecordInvoiceTransactionInput,
  ): Promise<Result<RecordInvoiceTransactionOutput, DomainError>> {
    const verified = this.deps.transactionVerifier.verify(input.rawBody, input.signature);
    if (verified === null) {
      return err(
        new AuthenticationError("Billing transaction callback signature verification failed"),
      );
    }

    const method = await this.deps.methods.findByProviderOrder(
      BILLING_PROVIDER,
      verified.providerOrderId,
      input.tenantId,
    );
    if (method === null || method.invoiceRef === undefined) {
      this.deps.logger.warn(
        "billing transaction callback for an order with no enrolled invoice — settling nothing",
        { providerOrderId: verified.providerOrderId },
      );
      return ok({ outcome: "no_enrolment" });
    }

    // Decide, from SIGNED flags only, whether this callback reports an actual settlement. A
    // pending, errored, voided, refunded, declined (`success: false`) or auth-without-capture
    // transaction is not a payment; it is acknowledged and the invoice is left exactly as it was
    // (relying on `Invoice.TRANSITIONS` to refuse un-paying is unnecessary here because these
    // branches never call `markPaid` in the first place).
    const isSettlement =
      verified.success &&
      !verified.pending &&
      !verified.errorOccured &&
      !verified.isVoided &&
      !verified.isRefunded &&
      !(verified.isAuth && !verified.isCapture);
    if (!isSettlement) {
      return ok({ outcome: "ignored" });
    }

    const invoiceRef = method.invoiceRef;
    const tenantRef = method.tenantRef;
    const settled = await this.withConcurrencyRetry(() =>
      this.deps.unitOfWork.run<Result<RecordInvoiceTransactionOutput, DomainError>>(async (tx) => {
        const invoice = await this.deps.invoices.findById(invoiceRef, input.tenantId, tx);
        if (invoice === null) {
          this.deps.logger.error(
            "billing transaction callback names an invoice that no longer exists",
            { invoiceId: invoiceRef, providerOrderId: verified.providerOrderId },
          );
          return ok({ outcome: "no_enrolment" });
        }
        // A replay of an already-settled invoice is a no-op — the state machine backs this too
        // (`paid` has no outgoing transitions), but checking here avoids calling `markPaid` at all.
        if (invoice.status === "paid") {
          return ok({ outcome: "already_paid" });
        }
        if (invoice.status !== "issued") {
          this.deps.logger.warn("billing transaction callback for an invoice that is not issued", {
            invoiceId: invoiceRef,
            status: invoice.status,
          });
          return ok({ outcome: "ignored" });
        }
        // Signed amount/currency must match the invoice's own total before it is trusted (the same
        // check `paymob-payment-provider.ts`'s MIT charge makes) — a mismatch settles nothing, and
        // is logged loud enough to reconcile by hand.
        if (verified.amountMinor !== invoice.totalMinor) {
          this.deps.logger.error(
            "billing transaction callback amount does not match the invoice total — invoice left untouched",
            {
              invoiceId: invoiceRef,
              signedAmountMinor: verified.amountMinor,
              invoiceTotalMinor: invoice.totalMinor,
            },
          );
          return ok({ outcome: "amount_mismatch" });
        }
        if (verified.currency !== invoice.currency) {
          this.deps.logger.error(
            "billing transaction callback currency does not match the invoice — invoice left untouched",
            {
              invoiceId: invoiceRef,
              signedCurrency: verified.currency,
              invoiceCurrency: invoice.currency,
            },
          );
          return ok({ outcome: "currency_mismatch" });
        }
        try {
          invoice.markPaid(
            verified.transactionId,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.invoices.save(invoice, input.tenantId, tx);
        return ok({ outcome: "paid" });
      }),
    );

    // Finance posting follows `CollectInvoice`'s shape: best-effort, and only when THIS call
    // performed the actual `markPaid` write — a replay that resolved to `already_paid` must not
    // double-post the same settlement.
    if (settled.ok && settled.value.outcome === "paid") {
      try {
        await this.deps.financeLedger.postSettlement(
          tenantRef,
          verified.amountMinor,
          verified.currency,
          verified.transactionId,
        );
      } catch {
        // Best-effort (see `CollectInvoice`): the collection itself already committed; a
        // ledger-post failure here is a Finance-side reconciliation gap, not a payment failure.
      }
    }
    return settled;
  }

  private async withConcurrencyRetry<T>(attempt: () => Promise<T>): Promise<T> {
    for (let i = 1; i <= RecordInvoiceTransaction.MAX_CONCURRENCY_RETRIES; i += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (
          !(error instanceof ConcurrencyError) ||
          i === RecordInvoiceTransaction.MAX_CONCURRENCY_RETRIES
        ) {
          throw error;
        }
      }
    }
    throw new Error("unreachable");
  }
}
