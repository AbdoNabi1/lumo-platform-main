import type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";

/** Raised for a `PaymentProvider` operation cash-on-delivery has no faithful equivalent for. */
export class CashOnDeliveryUnsupportedOperationError extends Error {
  readonly operation: string;

  constructor(operation: string, reason: string) {
    super(`Cash on delivery does not support "${operation}": ${reason}`);
    this.name = "CashOnDeliveryUnsupportedOperationError";
    this.operation = operation;
  }
}

/**
 * Cash on delivery as a payment method (WP-13 T13.4, decision 2). There is no external PSP: the
 * "provider" only makes the port's calls answer truthfully for a method where nobody is charged
 * online. Stateless — no per-merchant data — so one instance is safely shared.
 *
 * WHERE THE PORT DOES NOT FIT, and what each call does about it:
 *  - `createIntent` yields an UNPAID intent with no client handle — there is nothing for the shopper
 *    to pay online. Creating it never marks anything paid.
 *  - `capture` REFUSES. The port's "capture" means "charge what was authorized"; for cash there is no
 *    authorization and nobody to charge. The only thing that settles a COD intent is a confirmed
 *    collection (`ConfirmCodCollection`), an explicit operator action that is NOT a provider call.
 *    A capture that quietly succeeded would mark an order paid before anyone handed over cash.
 *  - `refund` REFUSES. Cash was paid out of band and can only be returned out of band; reporting
 *    success would record a refund nobody made. (Recording a manual cash refund is a follow-up.)
 *  - `cancel` succeeds: nothing exists at any external system, so "already cancelled / never
 *    captured, no-op" is exactly true.
 *  - `verifyWebhook` is always false: COD has no provider webhooks, so any request claiming to be
 *    one is unauthentic.
 */
export class CashOnDeliveryProvider implements PaymentProvider {
  createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    return Promise.resolve({ providerIntentId: `cod:${request.idempotencyKey}` });
  }

  capture(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    return Promise.reject(
      new CashOnDeliveryUnsupportedOperationError(
        "capture",
        "cash is not charged — confirm the collection instead",
      ),
    );
  }

  cancel(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    return Promise.resolve();
  }

  refund(_providerIntentId: string, _amountMinor: number, _idempotencyKey: string): Promise<void> {
    return Promise.reject(
      new CashOnDeliveryUnsupportedOperationError(
        "refund",
        "cash collected on delivery is returned outside the platform",
      ),
    );
  }

  verifyWebhook(_payload: Uint8Array, _signature: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
