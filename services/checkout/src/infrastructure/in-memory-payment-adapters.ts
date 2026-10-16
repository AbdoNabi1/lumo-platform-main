import type { PaymentInitiationPort, PaymentMethodPort } from "../application/ports";

/**
 * Offline stub for `PaymentMethodPort`: offers Stripe only — the one method that existed before
 * merchant configuration did, and the value every existing checkout selects. `wireAdmin`
 * unconditionally replaces it with the adapter over Payments' real merchant settings, so no
 * composed process resolves to it; it exists for direct `wireCheckout()` callers (tests).
 */
export class InMemoryPaymentMethodAdapter implements PaymentMethodPort {
  enabledMethods(_tenantId: string): Promise<readonly string[]> {
    return Promise.resolve(["stripe"]);
  }
}

/**
 * Offline stub for `PaymentInitiationPort`: fabricates a deterministic intent id and opens nothing.
 * Like `InMemoryOrderCreationAdapter`, `wireAdmin` overrides it with the real adapter over
 * Payments; it must never back a real checkout.
 */
export class InMemoryPaymentInitiationAdapter implements PaymentInitiationPort {
  initiate(input: { readonly orderRef: string; readonly provider: string }): Promise<{
    readonly paymentIntentId: string;
    readonly status: string;
    readonly provider: string;
  }> {
    return Promise.resolve({
      paymentIntentId: `payment-${input.orderRef}`,
      status: "created",
      provider: input.provider,
    });
  }
}
