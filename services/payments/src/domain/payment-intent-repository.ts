import type { PaymentIntent } from "./payment-intent";

/** Persistence port for {@link PaymentIntent}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface PaymentIntentRepository {
  save(intent: PaymentIntent, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<PaymentIntent | null>;
  /**
   * Looks up an intent by its caller-supplied idempotency key — scaffolding for A3's saga-activity
   * idempotency (Sprint A0 precondition). Returns `null` today for every key: the domain aggregate
   * carries no `idempotencyKey` field yet, so nothing writes the column this queries. A3 threads
   * the field through `PaymentIntent`/`CreatePaymentIntent` to make this live.
   */
  findByIdempotencyKey(idempotencyKey: string, tx?: unknown): Promise<PaymentIntent | null>;
  /**
   * Looks up an intent by the PSP's OWN reference (`PaymentIntent.pspReference`, set by
   * `AuthorizePayment` — e.g. Stripe's `pi_...` id). Phase A.10 (Tasks 4-6): a Stripe webhook's
   * `data.object.id` for `payment_intent.*` events IS this value, never our internally-generated
   * domain id — `findById` can never match it. Additive: existing callers that only ever look up by
   * domain id are unaffected.
   */
  findByPspReference(pspReference: string, tx?: unknown): Promise<PaymentIntent | null>;
}
