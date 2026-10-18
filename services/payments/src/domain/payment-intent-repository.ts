import type { PaymentIntent } from "./payment-intent";

/** Persistence port for {@link PaymentIntent}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface PaymentIntentRepository {
  save(intent: PaymentIntent, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<PaymentIntent | null>;
  /**
   * Looks up an intent by its caller-supplied idempotency key — scaffolding for A3's saga-activity
   * idempotency (Sprint A0 precondition). Returns `null` today for every key: the domain aggregate
   * carries no `idempotencyKey` field yet, so nothing writes the column this queries. A3 threads
   * the field through `PaymentIntent`/`CreatePaymentIntent` to make this live.
   */
  findByIdempotencyKey(
    idempotencyKey: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<PaymentIntent | null>;
  /**
   * Looks up an intent by the PSP's OWN reference (`PaymentIntent.pspReference`, set by
   * `AuthorizePayment` — e.g. Stripe's `pi_...` id). Phase A.10 (Tasks 4-6): a Stripe webhook's
   * `data.object.id` for `payment_intent.*` events IS this value, never our internally-generated
   * domain id — `findById` can never match it. Additive: existing callers that only ever look up by
   * domain id are unaffected.
   */
  findByPspReference(
    pspReference: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<PaymentIntent | null>;
}

/**
 * Order operations Part 1: many intents in ONE read (the orders list, export rows, packing slips and
 * the bulk "Mark cash as received"). A separate port so the many `PaymentIntentRepository` doubles in
 * tests stay valid. Ids of other shops and unknown ids are simply absent from the answer.
 */
export interface PaymentIntentBatchReader {
  findByIds(
    ids: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly PaymentIntent[]>;
}
