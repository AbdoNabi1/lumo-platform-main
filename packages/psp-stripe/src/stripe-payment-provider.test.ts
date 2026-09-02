import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@platform/utils";
import { StripeApiError, StripePaymentProvider, type HttpFetch } from "./stripe-payment-provider";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

function jsonResponse(status: number, body: unknown): { status: number; text(): Promise<string> } {
  return { status, text: async () => JSON.stringify(body) };
}

describe("StripePaymentProvider (C2-2 Task 2/8)", () => {
  it("creates an intent with capture_method=manual, amount/currency, metadata, and the Idempotency-Key header", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValue(jsonResponse(200, { id: "pi_123", client_secret: "pi_123_secret_abc" }));
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
    });

    const result = await provider.createIntent({
      tenantId: "t-1",
      orderRef: "order-1",
      amountMinor: 2500,
      currency: "USD",
      idempotencyKey: "idem-key-1",
    });

    expect(result).toEqual({ providerIntentId: "pi_123", clientHandle: "pi_123_secret_abc" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/payment_intents");
    expect(init?.headers?.["Idempotency-Key"]).toBe("idem-key-1");
    expect(init?.headers?.Authorization).toBe(
      `Basic ${Buffer.from("sk_test_123:").toString("base64")}`,
    );
    expect(init?.body).toContain("amount=2500");
    expect(init?.body).toContain("currency=usd");
    expect(init?.body).toContain("capture_method=manual");
    expect(init?.body).toContain("metadata%5Border_ref%5D=order-1");
  });

  it("captures with the given idempotency key", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValue(jsonResponse(200, { id: "pi_123", status: "succeeded" }));
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
    });

    await provider.capture("pi_123", "idem-capture-1");

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/payment_intents/pi_123/capture");
    expect(init?.headers?.["Idempotency-Key"]).toBe("idem-capture-1");
  });

  it("refunds with payment_intent + amount", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(jsonResponse(200, { id: "re_1" }));
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
    });

    await provider.refund("pi_123", 1000, "idem-refund-1");

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/refunds");
    expect(init?.body).toContain("payment_intent=pi_123");
    expect(init?.body).toContain("amount=1000");
  });

  it("propagates a payment failure (declined card) as a StripeApiError, never silently swallowed", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValue(
        jsonResponse(402, { error: { code: "card_declined", message: "Your card was declined." } }),
      );
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
    });

    await expect(provider.capture("pi_123", "idem-1")).rejects.toMatchObject({
      status: 402,
      stripeCode: "card_declined",
    });
  });

  it("treats cancelling an already-terminal intent as a no-op success (idempotent cancel contract)", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(
      jsonResponse(400, {
        error: { code: "payment_intent_unexpected_state", message: "already canceled" },
      }),
    );
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
    });

    await expect(provider.cancel("pi_123", "idem-cancel-1")).resolves.toBeUndefined();
  });

  it("does NOT swallow a cancel failure for any OTHER Stripe error code", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValue(
        jsonResponse(401, { error: { code: "api_key_expired", message: "expired" } }),
      );
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
    });

    await expect(provider.cancel("pi_123", "idem-cancel-2")).rejects.toBeInstanceOf(StripeApiError);
  });

  it("propagates a provider-unavailable network failure (fetch rejects) rather than swallowing it", async () => {
    const fetch = vi.fn<HttpFetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
    });

    await expect(
      provider.createIntent({
        tenantId: "t-1",
        orderRef: "order-1",
        amountMinor: 100,
        currency: "USD",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("propagates a provider timeout (abort) rather than hanging or swallowing it", async () => {
    const fetch = vi.fn<HttpFetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted")),
          );
        }),
    );
    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: "whsec_x",
      fetch,
      logger: silentLogger,
      timeoutMs: 5,
    });

    await expect(
      provider.createIntent({
        tenantId: "t-1",
        orderRef: "order-1",
        amountMinor: 100,
        currency: "USD",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow();
  });

  it("verifyWebhook delegates to the same HMAC scheme the standalone signature tests cover", async () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const secret = "whsec_provider_test";
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");

    const provider = new StripePaymentProvider({
      secretKey: "sk_test_123",
      webhookSecret: secret,
      fetch: vi.fn<HttpFetch>(),
      logger: silentLogger,
    });

    await expect(
      provider.verifyWebhook(new TextEncoder().encode(payload), `t=${ts},v1=${sig}`),
    ).resolves.toBe(true);
    await expect(
      provider.verifyWebhook(new TextEncoder().encode(payload), `t=${ts},v1=deadbeef`),
    ).resolves.toBe(false);
  });
});
