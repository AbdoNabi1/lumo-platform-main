import type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { verifyStripeSignature } from "./webhook-signature";

/** Minimal fetch shape — injectable so tests run without a real network call (same convention as `@platform/auth`'s `HttpFetch`). */
export type HttpFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly status: number; text(): Promise<string> }>;

export interface StripePaymentProviderOptions {
  /** Stripe secret key (`sk_test_...` / `sk_live_...`). Never logged, never persisted. */
  readonly secretKey: string;
  /** Webhook signing secret (`whsec_...`) from the Stripe Dashboard/CLI for this endpoint. */
  readonly webhookSecret: string;
  readonly fetch: HttpFetch;
  readonly logger: Logger;
  /** Override for sandbox/testing; defaults to Stripe's production API. */
  readonly apiBase?: string;
  /** Pinned Stripe API version — an account default drifting under us would be a silent contract change. */
  readonly apiVersion?: string;
  /** Per-request timeout; a hung PSP call must not hang the caller forever. */
  readonly timeoutMs?: number;
  /** Webhook replay-protection tolerance (seconds); Stripe's own default. */
  readonly webhookToleranceSeconds?: number;
}

interface StripeErrorBody {
  readonly error?: { readonly code?: string; readonly type?: string; readonly message?: string };
}

/** Raised for any non-2xx Stripe response that isn't handled as a documented idempotent no-op. */
export class StripeApiError extends Error {
  readonly status: number;
  readonly stripeCode: string | undefined;

  constructor(status: number, stripeCode: string | undefined, message: string) {
    super(message);
    this.name = "StripeApiError";
    this.status = status;
    this.stripeCode = stripeCode;
  }
}

const DEFAULT_API_BASE = "https://api.stripe.com";
const DEFAULT_API_VERSION = "2024-06-20";
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Production `PaymentProvider` (ADR-0012 §4, C2-2): Stripe over raw REST (`application/
 * x-www-form-urlencoded`, HTTP Basic auth with the secret key, no SDK — D-048's no-SDK convention,
 * same as `KetoAccessControl`/`JwtVerifier`). Every mutating call carries `Idempotency-Key` (Stripe
 * dedupes server-side on it for 24h) so a caller's retry after a timeout can never double-charge —
 * this adapter does not retry internally; that stays the caller's job (the saga activity per ADR-0012
 * §4's own doc comment), this adapter only makes retries SAFE. Card data never transits here — a
 * `PaymentIntentRequest` carries no card fields, only amount/currency/references (G-27).
 *
 * Intents are created with `capture_method: manual` so Stripe's own authorize→capture split matches
 * the domain's (`PaymentIntent` lifecycle, `AuthorizePayment`/`CapturePaymentLifecycle`) — a webhook
 * later confirms truth, this adapter's calls only initiate (doc comment on `PaymentProvider`).
 */
export class StripePaymentProvider implements PaymentProvider {
  private readonly options: StripePaymentProviderOptions;

  constructor(options: StripePaymentProviderOptions) {
    this.options = options;
  }

  async createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    const body = await this.request("POST", "/v1/payment_intents", request.idempotencyKey, {
      amount: String(request.amountMinor),
      currency: request.currency.toLowerCase(),
      capture_method: "manual",
      "automatic_payment_methods[enabled]": "true",
      "metadata[order_ref]": request.orderRef,
      "metadata[tenant_id]": request.tenantId,
    });
    const intent = body as { readonly id: string; readonly client_secret?: string | null };
    return {
      providerIntentId: intent.id,
      ...(intent.client_secret != null ? { clientHandle: intent.client_secret } : {}),
    };
  }

  async capture(providerIntentId: string, idempotencyKey: string): Promise<void> {
    await this.request(
      "POST",
      `/v1/payment_intents/${encodeURIComponent(providerIntentId)}/capture`,
      idempotencyKey,
      {},
    );
  }

  /** Idempotent per the port contract: a cancel of an already-canceled/already-succeeded intent is a no-op success. */
  async cancel(providerIntentId: string, idempotencyKey: string): Promise<void> {
    try {
      await this.request(
        "POST",
        `/v1/payment_intents/${encodeURIComponent(providerIntentId)}/cancel`,
        idempotencyKey,
        {},
      );
    } catch (error) {
      if (
        error instanceof StripeApiError &&
        error.stripeCode === "payment_intent_unexpected_state"
      ) {
        this.options.logger.info(
          "stripe cancel: intent already in a terminal state, treating as no-op",
          {
            providerIntentId,
          },
        );
        return;
      }
      throw error;
    }
  }

  async refund(
    providerIntentId: string,
    amountMinor: number,
    idempotencyKey: string,
  ): Promise<void> {
    await this.request("POST", "/v1/refunds", idempotencyKey, {
      payment_intent: providerIntentId,
      amount: String(amountMinor),
    });
  }

  async verifyWebhook(payload: Uint8Array, signature: string): Promise<boolean> {
    const valid = verifyStripeSignature({
      payload,
      signatureHeader: signature,
      secret: this.options.webhookSecret,
      toleranceSeconds: this.options.webhookToleranceSeconds,
    });
    if (!valid) {
      this.options.logger.warn("stripe webhook signature verification failed");
    }
    return valid;
  }

  private async request(
    method: string,
    path: string,
    idempotencyKey: string,
    form: Record<string, string>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.options.fetch(
        `${this.options.apiBase ?? DEFAULT_API_BASE}${path}`,
        {
          method,
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.options.secretKey}:`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
            "Stripe-Version": this.options.apiVersion ?? DEFAULT_API_VERSION,
          },
          body: new URLSearchParams(form).toString(),
          signal: controller.signal,
        },
      );
      const raw = await response.text();
      const isError = response.status < 200 || response.status >= 300;
      let parsed: unknown;
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : {};
      } catch (parseError) {
        if (isError) {
          throw new StripeApiError(
            response.status,
            undefined,
            `Stripe API request failed with status ${response.status} and a non-JSON body`,
          );
        }
        throw new StripeApiError(
          response.status,
          undefined,
          `Stripe API returned a successful status but an unparseable body: ${String(parseError)}`,
        );
      }
      if (isError) {
        const errorBody = parsed as StripeErrorBody;
        throw new StripeApiError(
          response.status,
          errorBody.error?.code,
          errorBody.error?.message ?? `Stripe API request failed with status ${response.status}`,
        );
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}
