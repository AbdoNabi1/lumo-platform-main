import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { concatenateSignedFields } from "@platform/psp-paymob";
import { loadRuntimeConfig } from "./config";
import { buildRuntimeCore } from "./composition";

/**
 * G-74 (1): Morbeh's own billing account, on Paymob, charging a merchant's saved card. Built from a
 * DEDICATED env group — never a merchant's credentials, never the store's — and sealing the token with
 * the REAL envelope vault. Everything below runs through the real composition root.
 */
const BILLING_SECRET = "egy_sk_MORBEH_BILLING";
const BILLING_HMAC = "hmac_MORBEH_BILLING";
const BILLING_PUBLIC = "egy_pk_MORBEH_BILLING";
const MERCHANT_HMAC = "hmac_a_merchants_own_account";

const baseEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
  PAYMENT_CREDENTIALS_KEK_REF: "k".repeat(40),
} as const;

const paymobEnv = {
  PLATFORM_BILLING_PAYMOB_SECRET_KEY: BILLING_SECRET,
  PLATFORM_BILLING_PAYMOB_HMAC_SECRET: BILLING_HMAC,
  PLATFORM_BILLING_PAYMOB_PUBLIC_KEY: BILLING_PUBLIC,
  PLATFORM_BILLING_PAYMOB_INTEGRATION_ID: "4001",
  PLATFORM_BILLING_PAYMOB_MOTO_INTEGRATION_ID: "4002",
  PLATFORM_BILLING_PAYMOB_REGION: "egy",
} as const;

const core = (env: Record<string, string>) =>
  buildRuntimeCore(loadRuntimeConfig({ ...baseEnv, ...env } as NodeJS.ProcessEnv));

const tokenCallback = {
  type: "TOKEN",
  obj: {
    id: 15978654,
    token: "3f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4",
    masked_pan: "xxxx-xxxx-xxxx-2346",
    merchant_id: 1053928,
    card_subtype: "MasterCard",
    created_at: "2026-08-24T13:28:31.015314",
    email: "kiyedi3052@claspira.com",
    order_id: "593881581",
  },
};
const CARD_TOKEN_CONCATENATION =
  "MasterCard2026-08-24T13:28:31.015314kiyedi3052@claspira.com15978654xxxx-xxxx-xxxx-234610539285938815813f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4";
const sign = (input: string, secret: string) =>
  createHmac("sha512", secret).update(input).digest("hex");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

afterEach(() => vi.unstubAllGlobals());

describe("composition of Morbeh's stored-method billing", () => {
  it("is absent unless configured — never a stub", () => {
    expect(core({}).platformBillingStoredMethod).toBeUndefined();
  });

  it("refuses a half-configured group, naming what is missing", () => {
    expect(() => core({ PLATFORM_BILLING_PAYMOB_SECRET_KEY: BILLING_SECRET })).toThrow(
      /PLATFORM_BILLING_PAYMOB_HMAC_SECRET/,
    );
  });

  it("refuses to compose without the credential vault the token must be sealed with", () => {
    expect(() =>
      buildRuntimeCore(
        loadRuntimeConfig({
          ...baseEnv,
          ...paymobEnv,
          PAYMENT_CREDENTIALS_KEK_REF: undefined,
        } as unknown as NodeJS.ProcessEnv),
      ),
    ).toThrow(/PAYMENT_CREDENTIALS_KEK_REF/);
  });
});

describe("the token is sealed with the real vault, bound to its payer", () => {
  it("round-trips for the payer, is not plaintext, and does not open for another merchant", async () => {
    const sealer = core(paymobEnv).platformBillingStoredMethod!.sealer;
    const token = "3f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4";

    const sealed = await sealer.seal("merchant-a", token);

    expect(sealer.backing).toBe("real");
    expect(sealed).not.toContain(token);
    expect(await sealer.open("merchant-a", sealed)).toBe(token);
    await expect(sealer.open("merchant-b", sealed)).rejects.toThrow();
  });
});

describe("the card-token callback is verified against Morbeh's billing secret, by the token scheme", () => {
  const verifier = () => core(paymobEnv).platformBillingStoredMethod!.cardTokenVerifier;

  it("accepts a callback signed under the card-token scheme with Morbeh's HMAC secret", () => {
    expect(
      verifier().verify(bytes(tokenCallback), sign(CARD_TOKEN_CONCATENATION, BILLING_HMAC)),
    ).toEqual({
      tokenId: "15978654",
      token: "3f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4",
      providerOrderId: "593881581",
      maskedPan: "xxxx-xxxx-xxxx-2346",
      cardSubtype: "MasterCard",
    });
  });

  it("rejects one signed with a MERCHANT's secret, and one signed under the transaction scheme", () => {
    expect(
      verifier().verify(bytes(tokenCallback), sign(CARD_TOKEN_CONCATENATION, MERCHANT_HMAC)),
    ).toBeNull();
    // Same secret, other scheme: a transaction-scheme concatenation cannot be built from a token
    // body (its fields are absent), so build the hybrid body both verifiers could read.
    const hybrid = {
      type: "TOKEN",
      obj: {
        ...tokenCallback.obj,
        amount_cents: 100000,
        created_at: tokenCallback.obj.created_at,
        currency: "EGP",
        error_occured: false,
        has_parent_transaction: false,
        integration_id: 4097558,
        is_3d_secure: true,
        is_auth: false,
        is_capture: false,
        is_refunded: false,
        is_standalone_payment: true,
        is_voided: false,
        order: { id: 217503754 },
        owner: 164295,
        pending: false,
        source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
        success: true,
      },
    };
    const transactionScheme = sign(concatenateSignedFields(hybrid.obj) ?? "", BILLING_HMAC);
    expect(verifier().verify(bytes(hybrid), transactionScheme)).toBeNull();
  });

  it("rejects a tampered body and a missing hmac", () => {
    const tampered = { ...tokenCallback, obj: { ...tokenCallback.obj, token: "attacker-token" } };
    expect(
      verifier().verify(bytes(tampered), sign(CARD_TOKEN_CONCATENATION, BILLING_HMAC)),
    ).toBeNull();
    expect(verifier().verify(bytes(tokenCallback), "")).toBeNull();
  });
});

describe("what goes on the wire", () => {
  interface Call {
    readonly url: string;
    readonly authorization: string | undefined;
    readonly body: Record<string, unknown>;
  }
  function stubPaymob(calls: Call[]) {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url,
        authorization: headers["Authorization"],
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      if (url.endsWith("/v1/intention/")) {
        const integration = (calls.at(-1)?.body["payment_methods"] as number[])[0];
        return new Response(
          JSON.stringify({
            intention_order_id: 777,
            client_secret: "csk_x",
            payment_keys: [{ integration, key: "payment-key-1" }],
          }),
          { status: 201 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          pending: false,
          error_occured: false,
          amount_cents: 149900,
          txn_response_code: "APPROVED",
        }),
        { status: 200 },
      );
    });
  }

  it("starts the first payment on Morbeh's card integration with Morbeh's key, returning the order id", async () => {
    const calls: Call[] = [];
    stubPaymob(calls);
    const stored = core(paymobEnv).platformBillingStoredMethod!;

    const checkout = await stored.enrolment.startCheckout({
      tenantRef: "merchant-1",
      amountMinor: 149900,
      currency: "EGP",
      idempotencyKey: "inv-1:0:enrol",
    });

    expect(calls[0]?.authorization).toBe(`Token ${BILLING_SECRET}`);
    expect(calls[0]?.body["payment_methods"]).toEqual([4001]);
    expect(checkout.providerOrderId).toBe("777");
    expect(checkout.checkoutUrl).toContain(`publicKey=${BILLING_PUBLIC}`);
  });

  it("charges the stored token on the MOTO integration, never the card one", async () => {
    const calls: Call[] = [];
    stubPaymob(calls);
    const stored = core(paymobEnv).platformBillingStoredMethod!;

    const charge = await stored.charger.chargeStoredMethod({
      tenantId: "merchant-1",
      orderRef: "billing:inv-1:0:collect",
      amountMinor: 149900,
      currency: "EGP",
      idempotencyKey: "inv-1:0:collect",
      storedMethodToken: "tok",
    });

    expect(charge.providerReference).toBe("777");
    expect(calls[0]?.body["payment_methods"]).toEqual([4002]);
    expect(calls[0]?.authorization).toBe(`Token ${BILLING_SECRET}`);
    expect(JSON.stringify(calls)).not.toContain('"payment_methods":[4001]');
  });

  it("without a MOTO integration id nothing is sent: no charge, and no fallback to the card integration", async () => {
    const calls: Call[] = [];
    stubPaymob(calls);
    const { PLATFORM_BILLING_PAYMOB_MOTO_INTEGRATION_ID: _moto, ...withoutMoto } = paymobEnv;
    const stored = core(withoutMoto).platformBillingStoredMethod!;

    await expect(
      stored.charger.chargeStoredMethod({
        tenantId: "merchant-1",
        orderRef: "o",
        amountMinor: 100,
        currency: "EGP",
        idempotencyKey: "k",
        storedMethodToken: "tok",
      }),
    ).rejects.toThrow(/MOTO/);
    expect(calls).toHaveLength(0);
  });
});

describe("the production boot guard counts stored-method billing as real billing", () => {
  it("is satisfied by it (no Stripe pair needed), and refuses one sealed by a stub", async () => {
    const { assertProductionLicensingBillingConfigured } = await import("./api");
    const stored = core(paymobEnv).platformBillingStoredMethod!;

    expect(() =>
      assertProductionLicensingBillingConfigured("production", {
        platformBillingPayments: undefined,
        platformBillingStoredMethod: stored,
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionLicensingBillingConfigured("production", {
        platformBillingPayments: undefined,
        platformBillingStoredMethod: { ...stored, sealer: { ...stored.sealer, backing: "stub" } },
      }),
    ).toThrow(/stub/);
    // Unchanged: nothing configured at all is still refused outside local.
    expect(() =>
      assertProductionLicensingBillingConfigured("production", {
        platformBillingPayments: undefined,
        platformBillingStoredMethod: undefined,
      }),
    ).toThrow(/PLATFORM_BILLING_STRIPE_SECRET_KEY/);
  });
});
