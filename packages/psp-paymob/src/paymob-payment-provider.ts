import type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import { verifyPaymobSignature } from "./webhook-signature";

/** Minimal fetch shape — injectable so tests never make a real network call (same as `psp-stripe`). */
export type HttpFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly status: number; text(): Promise<string> }>;

/**
 * Regions this adapter supports, with the API host and the Unified Checkout host Paymob documents
 * for each (developers.paymob.com "Overview" base URLs and "Unified Checkout (Redirection)", both
 * read 2026-09-23). Oman is deliberately absent: its currency (OMR) has three decimal places and
 * the docs do not say what "cents" means for it, so an `amountMinor` could be off by 10x. Add it
 * only once that is documented.
 */
const REGIONS = {
  egy: { api: "https://accept.paymob.com", checkout: "https://eg.checkout.paymob.com" },
  ksa: { api: "https://ksa.paymob.com", checkout: "https://ksa.checkout.paymob.com" },
  uae: { api: "https://uae.paymob.com", checkout: "https://uae.checkout.paymob.com" },
} as const;

export type PaymobRegion = keyof typeof REGIONS;

export function isPaymobRegion(value: string): value is PaymobRegion {
  return Object.prototype.hasOwnProperty.call(REGIONS, value);
}

export interface PaymobPaymentProviderOptions {
  /** Paymob SECRET key (`egy_sk_…`) — authorises API calls. Never logged, never persisted here. */
  readonly secretKey: string;
  /** The merchant's HMAC secret — verifies callbacks. */
  readonly hmacSecret: string;
  /** Paymob PUBLIC key (`egy_pk_…`) — half of the Unified Checkout URL. */
  readonly publicKey: string;
  /** The card (or wallet) integration id payments are created against. */
  readonly integrationId: number;
  readonly region: PaymobRegion;
  readonly fetch: HttpFetch;
  readonly logger: Logger;
  /** Optional per-intention callback URLs (otherwise the integration's dashboard settings apply). */
  readonly notificationUrl?: string;
  readonly redirectionUrl?: string;
  readonly timeoutMs?: number;
}

/** Raised for any non-2xx Paymob response, or a 2xx one that reports failure / lacks what we need. */
export class PaymobApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PaymobApiError";
    this.status = status;
  }
}

/**
 * Raised for a `PaymentProvider` operation Paymob's API has no faithful equivalent for. Thrown
 * rather than returning success: a no-op that reports success would let the domain record a
 * capture/cancellation that never happened.
 */
export class PaymobUnsupportedOperationError extends Error {
  readonly operation: string;

  constructor(operation: string, reason: string) {
    super(`Paymob does not support "${operation}" through this adapter: ${reason}`);
    this.name = "PaymobUnsupportedOperationError";
    this.operation = operation;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Production `PaymentProvider` for Paymob (raw REST, no SDK — D-048), created per request from a
 * merchant's own credentials (`TenantPaymentProviderResolver`, ADR-0014): one instance holds ONE
 * merchant's secret key and must never be shared across tenants.
 *
 * Sources for every shape below: Paymob's developer docs (Create Intention, HMAC Transaction
 * Callback, Unified Checkout redirection; read 2026-09-23) and Paymob's official Postman
 * collections (`PaymobAccept/API-Postman-Collections`, "Refund & Void & Capture APIs").
 *
 * Where the port's shape does not fit Paymob (each marked at its exact point below):
 *  - `capture`: a Paymob card "sale" is captured when the customer pays; there is no separate
 *    capture step to request. (Paymob's Capture API exists but only for `Auth`-type integrations
 *    and addresses a transaction id we do not have until the callback.) Unsupported.
 *  - `cancel`: no cancel-intention call. An unpaid intention just expires. Unsupported.
 *  - `refund`: addresses a Paymob TRANSACTION id (from the signed callback), not the intention's
 *    order id — so the payments context stores it (`providerTransactionRef`) and passes it here.
 *    Paymob's refund call takes no idempotency key, so `idempotencyKey` cannot be honoured by the
 *    provider; the payments domain's own durable refund reservation is the only double-refund
 *    guard, and this adapter — like the Stripe one — does not retry internally.
 */
export class PaymobPaymentProvider implements PaymentProvider {
  private readonly options: PaymobPaymentProviderOptions;

  constructor(options: PaymobPaymentProviderOptions) {
    this.options = options;
  }

  async createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
      throw new Error("Paymob createIntent: amountMinor must be a positive integer");
    }
    const body = await this.post("/v1/intention/", {
      amount: request.amountMinor,
      currency: request.currency.toUpperCase(),
      payment_methods: [this.options.integrationId],
      items: [
        {
          name: `Order ${request.orderRef}`,
          amount: request.amountMinor,
          description: `Order ${request.orderRef}`,
          quantity: 1,
        },
      ],
      // The API rejects an intention without billing_data (documented 400: `phone_number` "This
      // field is required."), but `PaymentIntentRequest` carries no customer identity and the port
      // is not widened for Paymob. The fields are filled with Paymob's own placeholder convention
      // ("NA", as in its published samples); the customer supplies real details on the hosted page.
      billing_data: {
        first_name: "NA",
        last_name: "NA",
        email: "na@example.invalid",
        phone_number: "NA",
        apartment: "NA",
        floor: "NA",
        street: "NA",
        building: "NA",
        city: "NA",
        state: "NA",
        country: "NA",
        postal_code: "NA",
      },
      // Echoed back as `order.merchant_order_id` — useful for support, but UNSIGNED, so nothing
      // in this codebase correlates on it (see webhook-signature.ts).
      special_reference: request.idempotencyKey,
      ...(this.options.notificationUrl !== undefined
        ? { notification_url: this.options.notificationUrl }
        : {}),
      ...(this.options.redirectionUrl !== undefined
        ? { redirection_url: this.options.redirectionUrl }
        : {}),
    });

    const orderId = (body as { intention_order_id?: unknown }).intention_order_id;
    const clientSecret = (body as { client_secret?: unknown }).client_secret;
    if (
      (typeof orderId !== "number" && typeof orderId !== "string") ||
      typeof clientSecret !== "string" ||
      clientSecret.length === 0
    ) {
      throw new PaymobApiError(
        201,
        "Paymob create-intention response lacked intention_order_id or client_secret",
      );
    }
    const checkout = new URL(REGIONS[this.options.region].checkout);
    checkout.searchParams.set("publicKey", this.options.publicKey);
    checkout.searchParams.set("clientSecret", clientSecret);
    return { providerIntentId: String(orderId), clientHandle: checkout.toString() };
  }

  capture(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    // DOES NOT FIT THE PORT: `capture` assumes an authorize→capture split (Stripe intents are
    // created `capture_method: manual`). A Paymob sale settles at payment time; the "captured"
    // signal is the signed callback, which drives `RecordWebhook`. Reporting success here would
    // record a capture nobody requested.
    return Promise.reject(
      new PaymobUnsupportedOperationError(
        "capture",
        "a Paymob sale is captured when the customer pays; the signed callback is the capture signal",
      ),
    );
  }

  cancel(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    // DOES NOT FIT THE PORT: the port promises an idempotent no-op success for a never-captured
    // intent, but Paymob has no way to cancel one — the customer could still pay it after we
    // marked it cancelled. Refusing is safer than a silent no-op.
    return Promise.reject(
      new PaymobUnsupportedOperationError(
        "cancel",
        "Paymob exposes no cancel-intention call; an unpaid intention only expires",
      ),
    );
  }

  async refund(
    providerTransactionRef: string,
    amountMinor: number,
    _idempotencyKey: string,
  ): Promise<void> {
    // `_idempotencyKey` is unusable: Paymob's refund call accepts none (see class doc).
    if (!/^\d+$/.test(providerTransactionRef)) {
      throw new Error(
        "Paymob refund needs the numeric Paymob transaction id (from the signed callback), " +
          "not an intention or order reference",
      );
    }
    const body = await this.post("/api/acceptance/void_refund/refund", {
      transaction_id: Number(providerTransactionRef),
      amount_cents: amountMinor,
    });
    // The legacy transaction endpoints answer HTTP 200 with the resulting transaction object, whose
    // `success` flag carries the outcome. The docs do not publish this response, so it is treated
    // defensively: an explicit `success: false` is a failed refund, never a silent success.
    if ((body as { success?: unknown }).success === false) {
      throw new PaymobApiError(200, "Paymob refund was rejected (success=false)");
    }
  }

  verifyWebhook(payload: Uint8Array, signature: string): Promise<boolean> {
    const valid = verifyPaymobSignature({
      payload,
      signature,
      secret: this.options.hmacSecret,
    });
    if (!valid) {
      this.options.logger.warn("paymob webhook signature verification failed");
    }
    return Promise.resolve(valid);
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      const response = await this.options.fetch(`${REGIONS[this.options.region].api}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${this.options.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let parsed: unknown;
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : {};
      } catch {
        // The raw body is not echoed: an error page can reflect request headers back.
        throw new PaymobApiError(
          response.status,
          `Paymob API responded ${response.status} with a non-JSON body`,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        const detail = (parsed as { detail?: unknown }).detail;
        throw new PaymobApiError(
          response.status,
          `Paymob API request failed with status ${response.status}` +
            (typeof detail === "string" ? `: ${detail}` : ""),
        );
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}
