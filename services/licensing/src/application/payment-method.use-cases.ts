import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  AuthenticationError,
  type DomainError,
  NotFoundError,
  isDomainError,
} from "@platform/utils";
import { BILLING_PROVIDER, BillingPaymentMethod } from "../domain/billing-payment-method";
import type { BillingPaymentMethodRepository, InvoiceRepository } from "../domain/repositories";
import type { BillingTokenSealer, CardEnrolmentPort, CardTokenCallbackVerifier } from "./ports";

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
