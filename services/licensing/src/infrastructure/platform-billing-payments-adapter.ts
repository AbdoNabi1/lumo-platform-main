import type { PaymentProvider } from "@platform/contracts";
import type { PaymentsPort } from "../application/ports";

export interface PlatformBillingPaymentsAdapterDeps {
  /**
   * MORBEH'S OWN PSP account's provider — never a merchant's. Deliberately a bare `PaymentProvider`
   * and NOT a resolver taking a tenant: money moves FROM the merchant TO Morbeh, so the credentials
   * on the wire are Morbeh's. A per-tenant resolver here (the WP-13 `TenantPaymentProviderResolver`,
   * which opens the MERCHANT's sealed credentials for the MERCHANT's store) would charge the
   * merchant through their own PSP account — the merchant paying themselves, Morbeh receiving
   * nothing. There is no `tenantRef` parameter on this dependency for that reason.
   */
  readonly provider: PaymentProvider;
}

/**
 * The real `PaymentsPort` (WP-14 T14.4): Morbeh charging a merchant for a subscription, as a third
 * CALLER of the `PaymentProvider` port WP-13 built (decision 2) — not a parallel payment path.
 *
 * What it deliberately does NOT do, and why (Trap 1 / WP-14 decision 3):
 *  - it never goes through `services/payments`' `PaymentController`/`PaymentIntent` repository. A
 *    billing charge is recorded on the `Invoice` (`paymentReference` = the provider's intent id), in
 *    the platform's `licensing` schema — there is NO `payments.payment_intents` row for it, so it is
 *    not tenant-scoped merchant data, cannot be read as a shopper's payment, and no store webhook
 *    handler can correlate to it (`RecordWebhook` finds no intent);
 *  - it owns no idempotency of its own: `collect()` derives both PSP keys from the caller's key
 *    (`CollectInvoice`'s deterministic `<invoiceId>:<version>:collect`), so a retry, a crash-recovery
 *    re-entry and a racing second call all present identical keys and the PSP dedupes them.
 *
 * FAILS SAFE: the port is an on-session contract (`createIntent` -> the payer confirms -> `capture`).
 * With no stored payment method / mandate for the merchant (a later WP), `capture` of an unconfirmed
 * intent is rejected by the PSP, `collect()` throws, and `CollectInvoice` marks the invoice `failed` —
 * the money is unmoved. It can never report a collection that did not happen.
 */
export class PlatformBillingPaymentsAdapter implements PaymentsPort {
  /** Read by `assertProductionLicensingBillingConfigured`: this is not the always-succeeds stub. */
  readonly backing = "real" as const;
  private readonly provider: PaymentProvider;

  constructor(deps: PlatformBillingPaymentsAdapterDeps) {
    this.provider = deps.provider;
  }

  async collect(
    tenantRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey?: string,
  ): Promise<{ reference: string }> {
    if (idempotencyKey === undefined || idempotencyKey.length === 0) {
      throw new Error(
        "PlatformBillingPaymentsAdapter.collect requires an idempotency key: a real charge must be dedupable",
      );
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error(
        `PlatformBillingPaymentsAdapter.collect: amountMinor must be a positive integer of minor units, got ${amountMinor}`,
      );
    }
    const intent = await this.provider.createIntent({
      // The PAYER, for the PSP's own reconciliation metadata — not a tenant scope of any row here.
      tenantId: tenantRef,
      orderRef: `billing:${idempotencyKey}`,
      amountMinor,
      currency,
      idempotencyKey: `${idempotencyKey}:intent`,
    });
    await this.provider.capture(intent.providerIntentId, `${idempotencyKey}:capture`);
    return { reference: intent.providerIntentId };
  }
}
