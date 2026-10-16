import type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";

/**
 * A recording `PaymentProvider` that models a Stripe-style idempotent PSP: the same idempotency key
 * dedupes to the SAME recorded effect, so `moved` counts real charges, not calls. `declineCapture`
 * makes `capture` reject the way an unconfirmed/declined intent does. Test-only.
 */
export class RecordingPaymentProvider implements PaymentProvider {
  readonly name: string;
  readonly intentRequests: PaymentIntentRequest[] = [];
  readonly captureCalls: Array<{ providerIntentId: string; idempotencyKey: string }> = [];
  /** Money actually moved: one entry per DISTINCT capture idempotency key that succeeded. */
  readonly moved: Array<{ providerIntentId: string; amountMinor: number; currency: string }> = [];
  declineCapture = false;
  private readonly intentsByKey = new Map<string, ProviderIntent>();
  private readonly amountByIntent = new Map<string, { amountMinor: number; currency: string }>();
  private readonly capturedKeys = new Set<string>();
  private counter = 0;

  constructor(name = "platform-psp") {
    this.name = name;
  }

  createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    this.intentRequests.push(request);
    const existing = this.intentsByKey.get(request.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);
    this.counter += 1;
    const intent: ProviderIntent = { providerIntentId: `${this.name}-pi-${this.counter}` };
    this.intentsByKey.set(request.idempotencyKey, intent);
    this.amountByIntent.set(intent.providerIntentId, {
      amountMinor: request.amountMinor,
      currency: request.currency,
    });
    return Promise.resolve(intent);
  }

  capture(providerIntentId: string, idempotencyKey: string): Promise<void> {
    this.captureCalls.push({ providerIntentId, idempotencyKey });
    if (this.declineCapture) return Promise.reject(new Error("card declined"));
    if (this.capturedKeys.has(idempotencyKey)) return Promise.resolve();
    this.capturedKeys.add(idempotencyKey);
    const amount = this.amountByIntent.get(providerIntentId);
    if (amount === undefined) {
      return Promise.reject(new Error(`unknown provider intent ${providerIntentId}`));
    }
    this.moved.push({ providerIntentId, ...amount });
    return Promise.resolve();
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  refund(): Promise<void> {
    return Promise.resolve();
  }

  verifyWebhook(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
