import type { OffSessionCharger } from "@platform/contracts";
import type { BillingTokenSealer, PaymentsPort } from "../application/ports";
import type { BillingPaymentMethodRepository } from "../domain/repositories";

/**
 * Raised when a merchant has no active stored card. `CollectInvoice` marks the invoice `failed` when
 * `collect` throws, so this is the visible outcome: the invoice fails, no charge is attempted, and
 * nothing reports a collection. It never falls back to an on-session payment and never skips silently.
 */
export class NoStoredPaymentMethodError extends Error {
  constructor() {
    super("No stored payment method on file for this merchant; nothing was charged");
    this.name = "NoStoredPaymentMethodError";
  }
}

export interface StoredMethodBillingPaymentsAdapterDeps {
  readonly methods: BillingPaymentMethodRepository;
  readonly sealer: BillingTokenSealer;
  /**
   * MORBEH'S OWN PSP account's off-session port — never a merchant's, for the same reason
   * `PlatformBillingPaymentsAdapter` takes a bare provider rather than a tenant resolver: a
   * per-merchant resolver would charge the merchant through their own PSP account. Typed as the
   * narrow `OffSessionCharger`, so a provider that cannot charge off-session is not assignable here.
   */
  readonly charger: OffSessionCharger;
}

/**
 * The real `PaymentsPort` for renewals (WP-14 follow-up G-74 (1)): charges the merchant's SAVED card
 * with no payer present, as the same third CALLER of a PSP port `PlatformBillingPaymentsAdapter` is —
 * feeding `CollectInvoice`/`BillSubscriptionRenewal` unchanged, not a second billing path.
 *
 *  - no active stored method ⇒ throws {@link NoStoredPaymentMethodError} BEFORE any PSP call;
 *  - the token is opened only for the one charge, held in a local, and handed to the charger;
 *  - it owns no idempotency of its own: the key is `CollectInvoice`'s deterministic
 *    `<invoiceId>:<version>:collect`, passed straight through;
 *  - like the on-session adapter it records nothing in `payments.payment_intents`: a billing charge
 *    is a fact about the `Invoice` (`paymentReference` = the PSP's reference), so no store handler
 *    can ever correlate to it.
 */
export class StoredMethodBillingPaymentsAdapter implements PaymentsPort {
  /** Read by `assertProductionLicensingBillingConfigured`: this is not the always-succeeds stub. */
  readonly backing = "real" as const;
  private readonly deps: StoredMethodBillingPaymentsAdapterDeps;

  constructor(deps: StoredMethodBillingPaymentsAdapterDeps) {
    this.deps = deps;
  }

  async collect(
    tenantRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey?: string,
    scopeTenantId?: string,
  ): Promise<{ reference: string }> {
    if (idempotencyKey === undefined || idempotencyKey.length === 0) {
      throw new Error(
        "StoredMethodBillingPaymentsAdapter.collect requires an idempotency key: a real charge must be dedupable",
      );
    }
    if (scopeTenantId === undefined || scopeTenantId.length === 0) {
      throw new Error(
        "StoredMethodBillingPaymentsAdapter.collect requires the platform tenant scope to find the stored method",
      );
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error(
        `StoredMethodBillingPaymentsAdapter.collect: amountMinor must be a positive integer of minor units, got ${amountMinor}`,
      );
    }

    const method = await this.deps.methods.findActiveByTenantRef(tenantRef, scopeTenantId);
    if (method === null) throw new NoStoredPaymentMethodError();

    const storedMethodToken = await this.deps.sealer.open(tenantRef, method.sealedTokenForCharge());
    const charge = await this.deps.charger.chargeStoredMethod({
      // The PAYER, for the PSP's own reconciliation metadata — not a tenant scope of any row here.
      tenantId: tenantRef,
      orderRef: `billing:${idempotencyKey}`,
      amountMinor,
      currency,
      idempotencyKey,
      storedMethodToken,
    });
    return { reference: charge.providerReference };
  }
}
