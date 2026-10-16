/**
 * Outbound PSP port (ADR-0012 §4; NO provider SDKs — adapters use raw REST like D-048). Every
 * money operation takes an `idempotencyKey` (the saga's `workflowId + step`) — providers dedupe
 * on it, so activity retries can never double-charge. Card data never transits the platform
 * (tokens only, G-27). Capture/failure TRUTH still arrives via webhook → outbox event → saga
 * signal (doc 22) — these calls initiate, the event confirms.
 */
export interface PaymentIntentRequest {
  readonly tenantId: string;
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly idempotencyKey: string;
}

export interface ProviderIntent {
  readonly providerIntentId: string;
  /** Client secret / redirect handle for the buyer-side confirmation step. */
  readonly clientHandle?: string;
}

export interface PaymentProvider {
  createIntent(request: PaymentIntentRequest): Promise<ProviderIntent>;
  capture(providerIntentId: string, idempotencyKey: string): Promise<void>;
  /** Idempotent; a cancel of a never-captured/already-cancelled intent is a no-op success. */
  cancel(providerIntentId: string, idempotencyKey: string): Promise<void>;
  refund(providerIntentId: string, amountMinor: number, idempotencyKey: string): Promise<void>;
  /** Constant-time webhook signature verification (doc 24 §5 conventions). */
  verifyWebhook(payload: Uint8Array, signature: string): Promise<boolean>;
}

/**
 * What a charge with NO PAYER PRESENT needs (merchant-initiated, e.g. a subscription renewal): the
 * payer's stored-method credential in place of a checkout the payer confirms.
 *
 * This is a SEPARATE port, not a method added to {@link PaymentProvider} — `createIntent` →
 * the payer confirms → `capture` cannot express "charge this saved token", and widening the shared
 * port to fit the providers that can would put a method on every provider that cannot. A provider
 * that can charge off-session implements BOTH; one that cannot implements only `PaymentProvider`, and
 * is then not assignable to {@link OffSessionCharger} — the compiler, not a runtime check, refuses it.
 */
export interface OffSessionChargeRequest {
  /** The PAYER, for the PSP's own reconciliation metadata — not a tenant scope of any row. */
  readonly tenantId: string;
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** Deterministic per attempt: a retry of the same attempt must present the same key. */
  readonly idempotencyKey: string;
  /**
   * The payer's stored-method credential, exactly as the PSP issued it. A SECRET: it charges the
   * card. Never logged, never put in an error message, never serialised into a DTO.
   */
  readonly storedMethodToken: string;
}

export interface OffSessionCharge {
  /** The PSP's reference for the collected payment; recorded on the invoice. */
  readonly providerReference: string;
}

export interface OffSessionCharger {
  /**
   * Charges the stored method and resolves ONLY if the PSP reports the payment approved and final.
   * Anything else — a decline, a pending/unknown outcome, a missing configuration — THROWS: a
   * resolved promise is a collection, and nothing may report one that did not happen.
   */
  chargeStoredMethod(request: OffSessionChargeRequest): Promise<OffSessionCharge>;
}

/** A provider that can do both an on-session payment and an off-session charge. */
export type OffSessionPaymentProvider = PaymentProvider & OffSessionCharger;
