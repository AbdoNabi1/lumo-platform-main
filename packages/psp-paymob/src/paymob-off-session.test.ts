import { describe, expect, it, vi } from "vitest";
import type { OffSessionChargeRequest } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import createIntentResponse from "./__fixtures__/create-intention.response.json";
import mitPayResponse from "./__fixtures__/mit-pay.response.json";
import {
  PaymobApiError,
  PaymobMitNotConfiguredError,
  PaymobPaymentProvider,
  type HttpFetch,
  type PaymobPaymentProviderOptions,
} from "./paymob-payment-provider";

/**
 * MIT (merchant-initiated) charge against a saved card token. The request shapes are Paymob's own,
 * from the official Postman collection `PaymobAccept/API-Postman-Collections` ("Pay with saved card",
 * MIT folder, read 2026-09-24): (1) create an intention on the MOTO integration, (2) POST
 * `/api/acceptance/payments/pay` with `{ source: { identifier: <token>, subtype: "TOKEN" },
 * payment_token: <the intention's payment key> }`. The collection documents the pay response's
 * success fields (`success`, `txn_response_code`, `data.message`, `amount_cents`, `source_data`)
 * but not a full body: `mit-pay.response.json` is therefore built from exactly those documented
 * fields (plus the `pending`/`error_occured` flags every Paymob transaction carries), not recorded
 * from a live call, and the adapter reads nothing else from it.
 */
const MOTO_INTEGRATION = 777;
const TOKEN = "3f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4";

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

/** The recorded create-intention response, re-keyed so its payment key belongs to the MOTO integration. */
const motoIntention = {
  ...createIntentResponse,
  payment_keys: [{ ...createIntentResponse.payment_keys[0], integration: MOTO_INTEGRATION }],
};

function provider(
  fetch: HttpFetch,
  overrides: Partial<PaymobPaymentProviderOptions> = {},
  logger: Logger = silentLogger,
): PaymobPaymentProvider {
  return new PaymobPaymentProvider({
    secretKey: "egy_sk_test_secret",
    hmacSecret: "hmac-secret",
    publicKey: "egy_pk_test_public",
    integrationId: 158,
    motoIntegrationId: MOTO_INTEGRATION,
    region: "egy",
    fetch,
    logger,
    ...overrides,
  });
}

const charge: OffSessionChargeRequest = {
  tenantId: "merchant-1",
  orderRef: "billing:inv-1:0:collect",
  amountMinor: 149900,
  currency: "EGP",
  idempotencyKey: "inv-1:0:collect",
  storedMethodToken: TOKEN,
};

function happyFetch() {
  return vi
    .fn<HttpFetch>()
    .mockResolvedValueOnce(json(201, motoIntention))
    .mockResolvedValueOnce(json(200, mitPayResponse));
}

describe("PaymobPaymentProvider.chargeStoredMethod — the documented MIT flow", () => {
  it("creates an intention on the MOTO integration, then pays it with the TOKEN source", async () => {
    const fetch = happyFetch();
    const result = await provider(fetch).chargeStoredMethod(charge);

    expect(fetch).toHaveBeenCalledTimes(2);
    const [intentionUrl, intentionInit] = fetch.mock.calls[0]!;
    expect(intentionUrl).toBe("https://accept.paymob.com/v1/intention/");
    expect(intentionInit?.headers?.Authorization).toBe("Token egy_sk_test_secret");
    expect(JSON.parse(intentionInit?.body ?? "{}")).toMatchObject({
      amount: 149900,
      currency: "EGP",
      payment_methods: [MOTO_INTEGRATION],
      special_reference: "inv-1:0:collect",
    });

    const [payUrl, payInit] = fetch.mock.calls[1]!;
    expect(payUrl).toBe("https://accept.paymob.com/api/acceptance/payments/pay");
    expect(payInit?.method).toBe("POST");
    expect(JSON.parse(payInit?.body ?? "{}")).toEqual({
      source: { identifier: TOKEN, subtype: "TOKEN" },
      payment_token: createIntentResponse.payment_keys[0]!.key,
    });
    // The collection's pay request carries only Content-Type: the payment key is its credential.
    expect(payInit?.headers?.Authorization).toBeUndefined();

    // The provider reference is the intention's order id — the id Paymob signs into its callbacks.
    expect(result).toEqual({ providerReference: String(createIntentResponse.intention_order_id) });
  });

  it("never touches the standard (on-session) integration", async () => {
    const fetch = happyFetch();
    await provider(fetch).chargeStoredMethod(charge);
    const wire = fetch.mock.calls.map(([, init]) => init?.body ?? "").join("\n");
    expect(wire).not.toContain('"payment_methods":[158]');
  });

  it("fails closed with no MOTO integration configured: nothing is sent, no fallback to a normal sale", async () => {
    const fetch = vi.fn<HttpFetch>();
    const withoutMoto = new PaymobPaymentProvider({
      secretKey: "egy_sk_test_secret",
      hmacSecret: "hmac-secret",
      publicKey: "egy_pk_test_public",
      integrationId: 158,
      region: "egy",
      fetch,
      logger: silentLogger,
    });
    await expect(withoutMoto.chargeStoredMethod(charge)).rejects.toBeInstanceOf(
      PaymobMitNotConfiguredError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the intention returned no payment key for the MOTO integration", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValueOnce(json(201, createIntentResponse)); // key is for 158
    await expect(provider(fetch).chargeStoredMethod(charge)).rejects.toBeInstanceOf(PaymobApiError);
    expect(fetch).toHaveBeenCalledTimes(1); // never reached the pay call
  });

  it.each([
    ["a decline", { ...mitPayResponse, success: false, txn_response_code: "DECLINED" }],
    ["a non-APPROVED code on success:true", { ...mitPayResponse, txn_response_code: "5" }],
    ["a pending outcome", { ...mitPayResponse, pending: true }],
    ["an error flag", { ...mitPayResponse, error_occured: true }],
    ["a different amount than requested", { ...mitPayResponse, amount_cents: 100 }],
    ["a body with no success flag", { txn_response_code: "APPROVED" }],
  ])("reports no collection for %s", async (_name, payBody) => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(json(201, motoIntention))
      .mockResolvedValueOnce(json(200, payBody));
    await expect(provider(fetch).chargeStoredMethod(charge)).rejects.toBeInstanceOf(PaymobApiError);
  });

  it("reports no collection for a non-2xx pay response", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(json(201, motoIntention))
      .mockResolvedValueOnce(json(400, { detail: "bad" }));
    await expect(provider(fetch).chargeStoredMethod(charge)).rejects.toBeInstanceOf(PaymobApiError);
  });

  it("never puts the stored token in an error message or a log line", async () => {
    const logger: Logger = { ...silentLogger, warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(json(201, motoIntention))
      .mockResolvedValueOnce(json(200, { ...mitPayResponse, success: false }));
    const failure = await provider(fetch, {}, logger)
      .chargeStoredMethod(charge)
      .catch((e: unknown) => e as Error);
    expect((failure as Error).message).not.toContain(TOKEN);
    expect(
      JSON.stringify([logger.warn, logger.error, logger.info].map((f) => vi.mocked(f).mock.calls)),
    ).not.toContain(TOKEN);
  });

  it.each([
    ["a zero amount", { amountMinor: 0 }],
    ["a fractional amount", { amountMinor: 10.5 }],
    ["an empty token", { storedMethodToken: "" }],
    ["an empty idempotency key", { idempotencyKey: "" }],
  ])("refuses %s before any call", async (_name, patch) => {
    const fetch = vi.fn<HttpFetch>();
    await expect(provider(fetch).chargeStoredMethod({ ...charge, ...patch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
