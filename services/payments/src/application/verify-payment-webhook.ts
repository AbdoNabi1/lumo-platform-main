import { isWellFormedProviderKey } from "../domain/value-objects/payment-provider-key";
import { PaymentProviderUnavailableError, type PaymentProviderResolver } from "./ports";

export interface VerifyPaymentWebhookInput {
  /** ADR-0014: the tenant the webhook is being delivered to. Its credentials — and only its — verify the signature. */
  readonly tenantId: string;
  readonly provider: string;
  readonly payload: Uint8Array;
  /** Stripe: the `Stripe-Signature` header. Paymob: the `hmac` query parameter. */
  readonly signature: string;
}

/**
 * Verifies a provider webhook against the TENANT's own provider credentials (resolved per request,
 * ADR-0014). Returns `false` — never throws — for an unknown provider, a provider the platform
 * cannot back, credentials that will not open, or a bad signature: a webhook is either
 * authenticated or it is not, and every "not" is a 401 at the route.
 *
 * Uses `resolveForExisting`: a merchant who switched a method off must still receive the callbacks
 * for payments already taken through it.
 */
export class VerifyPaymentWebhook {
  private readonly providers: PaymentProviderResolver;

  constructor(providers: PaymentProviderResolver) {
    this.providers = providers;
  }

  async execute(input: VerifyPaymentWebhookInput): Promise<boolean> {
    if (!isWellFormedProviderKey(input.provider)) return false;
    // A provider that does not declare it delivers webhooks cannot have authentic ones: refuse
    // BEFORE asking it, so a lax `verifyWebhook` cannot turn a forged request into an accepted one.
    if (this.providers.capabilitiesOf(input.provider)?.deliversWebhooks !== true) return false;
    try {
      const provider = await this.providers.resolveForExisting(input.tenantId, input.provider);
      return await provider.verifyWebhook(input.payload, input.signature);
    } catch (error) {
      if (error instanceof PaymentProviderUnavailableError) return false;
      throw error;
    }
  }
}
