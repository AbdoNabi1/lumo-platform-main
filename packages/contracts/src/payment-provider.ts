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
