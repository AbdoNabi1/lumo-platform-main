import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@platform/utils";
import createIntentResponse from "./__fixtures__/create-intention.response.json";
import callbackFixture from "./__fixtures__/transaction-processed-callback.json";
import {
  PaymobApiError,
  PaymobPaymentProvider,
  PaymobUnsupportedOperationError,
  type HttpFetch,
  type PaymobPaymentProviderOptions,
} from "./paymob-payment-provider";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const json = (status: number, body: unknown) => ({
  status,
  text: async () => JSON.stringify(body),
});

function provider(
  fetch: HttpFetch,
  overrides: Partial<PaymobPaymentProviderOptions> = {},
): PaymobPaymentProvider {
  return new PaymobPaymentProvider({
    secretKey: "egy_sk_test_secret",
    hmacSecret: "hmac-secret",
    publicKey: "egy_pk_test_public",
    integrationId: 158,
    region: "egy",
    fetch,
    logger: silentLogger,
    ...overrides,
  });
}

const request = {
  tenantId: "tenant-a",
  orderRef: "order-1",
  amountMinor: 2000,
  currency: "EGP",
  idempotencyKey: "intent-1:create",
};

describe("PaymobPaymentProvider — against Paymob's recorded create-intention response", () => {
  it("POSTs /v1/intention/ with the Token-prefixed secret key and the documented body", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(201, createIntentResponse));
    await provider(fetch).createIntent(request);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://accept.paymob.com/v1/intention/");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.Authorization).toBe("Token egy_sk_test_secret");
    expect(init?.headers?.["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      amount: 2000,
      currency: "EGP",
      payment_methods: [158],
      special_reference: "intent-1:create",
    });
    expect(body.items).toEqual([
      expect.objectContaining({ amount: 2000, quantity: 1, name: expect.any(String) }),
    ]);
    // billing_data.phone_number is required by the API (its documented 400) — the port carries no
    // customer identity, so it is filled, never omitted.
    expect(body.billing_data).toEqual(
      expect.objectContaining({ phone_number: expect.any(String) }),
    );
  });

  it("returns the order id (the value Paymob signs into every callback) as the provider id", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(201, createIntentResponse));
    const result = await provider(fetch).createIntent(request);

    expect(result.providerIntentId).toBe(String(createIntentResponse.intention_order_id));
    // The callback fixture's `order.id` is a different order; assert the mapping, not a constant.
    expect(result.providerIntentId).toBe("265715202");
  });

  it("builds the Unified Checkout URL from the public key and the response's client secret", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(201, createIntentResponse));
    const { clientHandle } = await provider(fetch).createIntent(request);

    const url = new URL(clientHandle as string);
    expect(url.origin).toBe("https://eg.checkout.paymob.com");
    expect(url.searchParams.get("publicKey")).toBe("egy_pk_test_public");
    expect(url.searchParams.get("clientSecret")).toBe(createIntentResponse.client_secret);
  });

  it("never puts the secret key, the HMAC secret or the response's payment keys in the result", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(201, createIntentResponse));
    const result = JSON.stringify(await provider(fetch).createIntent(request));
    expect(result).not.toContain("egy_sk_test_secret");
    expect(result).not.toContain("hmac-secret");
    expect(result).not.toContain("payment_keys");
  });

  it("targets the region's API host", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(201, createIntentResponse));
    await provider(fetch, { region: "ksa" }).createIntent({ ...request, currency: "SAR" });
    expect(fetch.mock.calls[0]![0]).toBe("https://ksa.paymob.com/v1/intention/");
  });

  it("surfaces Paymob's documented 404 (bad integration id) as a typed error without leaking the key", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValue(
        json(404, { detail: "Integration ID/Name does not exist in our system ." }),
      );
    const failure = await provider(fetch)
      .createIntent(request)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PaymobApiError);
    expect((failure as PaymobApiError).status).toBe(404);
    expect(String((failure as Error).message)).not.toContain("egy_sk_test_secret");
  });

  it("rejects a 2xx response missing the order id instead of inventing a provider id", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(201, { id: "pi_x" }));
    await expect(provider(fetch).createIntent(request)).rejects.toBeInstanceOf(PaymobApiError);
  });

  it("rejects a non-integer amount before any network call", async () => {
    const fetch = vi.fn<HttpFetch>();
    await expect(provider(fetch).createIntent({ ...request, amountMinor: 10.5 })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not retry internally on a network failure", async () => {
    const fetch = vi.fn<HttpFetch>().mockRejectedValue(new Error("socket hang up"));
    await expect(provider(fetch).createIntent(request)).rejects.toThrow("socket hang up");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("PaymobPaymentProvider — refund", () => {
  it("POSTs /api/acceptance/void_refund/refund with the transaction id and amount", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(200, { success: true }));
    await provider(fetch).refund("192036465", 500, "intent-1:refund:r1");

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://accept.paymob.com/api/acceptance/void_refund/refund");
    expect(init?.headers?.Authorization).toBe("Token egy_sk_test_secret");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({
      transaction_id: 192036465,
      amount_cents: 500,
    });
  });

  it("refuses a provider reference that is not a numeric transaction id (e.g. an order id placeholder)", async () => {
    const fetch = vi.fn<HttpFetch>();
    await expect(provider(fetch).refund("pi_test_x", 500, "k")).rejects.toThrow(/transaction id/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats an HTTP-200 body reporting success:false as a failed refund, never a silent success", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(200, { success: false }));
    await expect(provider(fetch).refund("192036465", 500, "k")).rejects.toBeInstanceOf(
      PaymobApiError,
    );
  });

  it("throws on a non-2xx refund", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(json(400, { detail: "nope" }));
    await expect(provider(fetch).refund("192036465", 500, "k")).rejects.toBeInstanceOf(
      PaymobApiError,
    );
  });
});

describe("PaymobPaymentProvider — operations that do not map onto Paymob", () => {
  it("capture is unsupported: a Paymob sale is captured when the customer pays", async () => {
    const fetch = vi.fn<HttpFetch>();
    await expect(provider(fetch).capture("265715202", "k")).rejects.toBeInstanceOf(
      PaymobUnsupportedOperationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancel is unsupported: there is no cancel-intention call, so a no-op success would be a lie", async () => {
    const fetch = vi.fn<HttpFetch>();
    await expect(provider(fetch).cancel("265715202", "k")).rejects.toBeInstanceOf(
      PaymobUnsupportedOperationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("PaymobPaymentProvider.verifyWebhook", () => {
  const body = new TextEncoder().encode(JSON.stringify(callbackFixture));
  const signed =
    "1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue";

  it("accepts a callback signed with the merchant's HMAC secret and rejects any other secret", async () => {
    const good = createHmac("sha512", "hmac-secret").update(signed).digest("hex");
    const other = createHmac("sha512", "hmac-secret-of-another-merchant")
      .update(signed)
      .digest("hex");
    const p = provider(vi.fn<HttpFetch>());
    expect(await p.verifyWebhook(body, good)).toBe(true);
    expect(await p.verifyWebhook(body, other)).toBe(false);
  });
});

describe("PaymobPaymentProvider never logs a credential", () => {
  it("across success, API failure, refund failure and a rejected webhook", async () => {
    const lines: string[] = [];
    const recording: Logger = {
      debug: (m, c) => void lines.push(`${m} ${JSON.stringify(c ?? {})}`),
      info: (m, c) => void lines.push(`${m} ${JSON.stringify(c ?? {})}`),
      warn: (m, c) => void lines.push(`${m} ${JSON.stringify(c ?? {})}`),
      error: (m, c) => void lines.push(`${m} ${JSON.stringify(c ?? {})}`),
      child: () => recording,
    };
    const fetchOk = vi.fn<HttpFetch>().mockResolvedValue(json(201, createIntentResponse));
    const fetchBad = vi.fn<HttpFetch>().mockResolvedValue(json(400, { detail: "nope" }));
    const ok = provider(fetchOk, { logger: recording });
    const bad = provider(fetchBad, { logger: recording });

    await ok.createIntent(request);
    await bad.createIntent(request).catch(() => undefined);
    await bad.refund("192036465", 100, "k").catch(() => undefined);
    await ok.verifyWebhook(new TextEncoder().encode("{}"), "0".repeat(128));

    const output = lines.join("\n");
    for (const secret of ["egy_sk_test_secret", "hmac-secret", "egy_pk_test_public"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("paymob webhook signature verification failed");
  });
});
