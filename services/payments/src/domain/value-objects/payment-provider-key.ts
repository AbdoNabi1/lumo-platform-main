/**
 * The payment methods a shopper can select and a merchant can enable (WP-13, decisions 1-3).
 * A closed set: the key is persisted on the intent and selects the adapter, so an unknown value
 * must never reach either.
 *
 * The shopper's explicit choice is the ONLY thing that picks one of these. Nothing in payments —
 * not the resolver, not merchant configuration order, not a fee or success-rate preference —
 * chooses a provider on the shopper's behalf (WP-13 decision 3, "known traps").
 */
export const PAYMENT_PROVIDER_KEYS = ["stripe", "paymob", "cod"] as const;

export type PaymentProviderKey = (typeof PAYMENT_PROVIDER_KEYS)[number];

export function isPaymentProviderKey(value: unknown): value is PaymentProviderKey {
  return typeof value === "string" && (PAYMENT_PROVIDER_KEYS as readonly string[]).includes(value);
}

/**
 * Providers whose money is settled at the moment the customer pays / hands over cash, so there is
 * no separate "request capture" step: a Paymob sale is captured when the customer pays (the signed
 * callback is the signal) and cash-on-delivery is "captured" when the courier hands the cash over.
 * Stripe alone runs the authorize → capture split the lifecycle's `capture_requested` models.
 */
const DIRECT_CAPTURE: ReadonlySet<PaymentProviderKey> = new Set(["paymob", "cod"]);

export function isDirectCaptureProvider(provider: PaymentProviderKey): boolean {
  return DIRECT_CAPTURE.has(provider);
}

/**
 * Whether a provider can report anything back through a webhook. Cash on delivery cannot: there is
 * no PSP to call us. A webhook naming `cod` is therefore never authentic, and must not be able to
 * settle a COD payment — only an operator's confirmed collection does.
 */
export function hasProviderWebhooks(provider: PaymentProviderKey): boolean {
  return provider !== "cod";
}
