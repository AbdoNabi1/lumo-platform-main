import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing } from "@platform/licensing";
import { wirePayments } from "@platform/payments";
import { loadRuntimeConfig } from "./config";
import { buildRuntimeCore } from "./composition";

/**
 * WP-14 T14.4, Trap 1 — WHOSE PSP ACCOUNT. When Morbeh charges merchant X the money moves from X to
 * Morbeh, so the credentials on the wire are MORBEH's. Reusing WP-13's `TenantPaymentProviderResolver`
 * here would charge X through X's own Paymob account: the merchant paying themselves.
 *
 * These tests observe the OUTBOUND HTTP, not the object graph, so they fail for ANY wiring that
 * routes a billing charge through a merchant's credentials — however it is wired — and for any
 * wiring that lets a billing charge land where a store payment would be read.
 */
const PLATFORM = "platform-tenant";
const MERCHANT = "merchant-1";
const STORE_STRIPE_KEY = "sk_test_STORE_ACCOUNT";
const STORE_WEBHOOK_SECRET = "whsec_STORE_ENDPOINT";
const BILLING_STRIPE_KEY = "sk_test_MORBEH_BILLING";
const BILLING_WEBHOOK_SECRET = "whsec_MORBEH_BILLING_ENDPOINT";
const MERCHANT_PAYMOB_KEY = "egy_sk_MERCHANT_OWN_ACCOUNT";

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
  STRIPE_SECRET_KEY: STORE_STRIPE_KEY,
  STRIPE_WEBHOOK_SECRET: STORE_WEBHOOK_SECRET,
  PLATFORM_BILLING_STRIPE_SECRET_KEY: BILLING_STRIPE_KEY,
  PLATFORM_BILLING_STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
  PAYMENT_CREDENTIALS_KEK_REF: "k".repeat(40),
} as NodeJS.ProcessEnv;

interface OutboundCall {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string | undefined;
}

let outbound: OutboundCall[] = [];

beforeEach(() => {
  outbound = [];
  let intents = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    outbound.push({
      url,
      authorization: headers["Authorization"],
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (url.endsWith("/v1/payment_intents")) {
      intents += 1;
      return new Response(JSON.stringify({ id: `pi_billing_${intents}`, client_secret: "cs" }), {
        status: 200,
      });
    }
    if (url.endsWith("/capture")) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ error: { message: `unexpected call ${url}` } }), {
      status: 500,
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-10-01T00:00:00.000Z") };

async function renewalThroughRealComposition() {
  const core = buildRuntimeCore(loadRuntimeConfig(validEnv));

  // The MERCHANT has its own Paymob account, configured through WP-13's real per-tenant path.
  const payments = wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    paymentProvider: core.paymentProvider,
    providerRegistrations: core.providerRegistrations,
    paymentCredentialVault: core.paymentCredentialVault,
  });
  const configured = await payments.payments.updateMerchantPaymentSettings({
    tenantId: MERCHANT,
    enabledMethods: ["stripe", "paymob"],
    providerSettings: {
      paymob: {
        config: { region: "egy", integrationId: 158 },
        credentials: {
          secretKey: MERCHANT_PAYMOB_KEY,
          hmacSecret: "hmac_merchant_own",
          publicKey: "egy_pk_merchant_own",
        },
      },
    },
  });
  expect(configured.status).toBe(200);

  // Morbeh bills that merchant through the runtime's REAL platform-billing composition.
  const licensing = wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    platformTenantId: PLATFORM,
    ...(core.platformBillingPayments === undefined
      ? {}
      : { payments: core.platformBillingPayments }),
  });
  const plan = await licensing.licensing.createPlan({
    key: "growth",
    name: "Growth",
    tier: "growth",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await licensing.licensing.createPlanDraft({
    planId,
    tenantId: PLATFORM,
    spec: {
      limits: {},
      featureEntitlements: [],
      pricing: {
        basePriceMinor: 149900,
        currency: "EGP",
        billingCycle: "monthly",
        creditAllowances: {},
      },
    },
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  await licensing.licensing.publishPlanVersion({ planId, planVersionId, tenantId: PLATFORM });
  const subscription = await licensing.licensing.createSubscription({
    tenantRef: MERCHANT,
    planVersionRef: planVersionId,
    tenantId: PLATFORM,
  });
  const subscriptionId = (subscription.body as { id: string }).id;
  await licensing.licensing.activateSubscription({ subscriptionId, tenantId: PLATFORM });
  const renewal = await licensing.licensing.billSubscriptionRenewal({
    subscriptionId,
    tenantId: PLATFORM,
  });
  return { core, payments, renewal };
}

const decodeBasic = (authorization: string | undefined) =>
  Buffer.from((authorization ?? "").replace(/^Basic /, ""), "base64").toString("utf8");

describe("a subscription renewal charges through MORBEH's provider, never the merchant's", () => {
  it("every outbound charge call uses Morbeh's billing credentials, on Stripe", async () => {
    const { renewal } = await renewalThroughRealComposition();

    expect(renewal.status).toBe(200);
    expect((renewal.body as { status: string }).status).toBe("paid");
    expect(outbound.length).toBeGreaterThanOrEqual(2); // createIntent + capture
    for (const call of outbound) {
      expect(call.url.startsWith("https://api.stripe.com/")).toBe(true);
      expect(decodeBasic(call.authorization)).toBe(`${BILLING_STRIPE_KEY}:`);
    }
  });

  it("the merchant's own Paymob credentials (and the store's Stripe key) are never used or sent", async () => {
    await renewalThroughRealComposition();

    const wire = JSON.stringify(outbound);
    expect(wire).not.toContain(MERCHANT_PAYMOB_KEY);
    expect(wire).not.toContain("hmac_merchant_own");
    expect(wire).not.toContain(STORE_STRIPE_KEY);
    expect(outbound.some((call) => call.url.includes("paymob"))).toBe(false);
  });

  it("charges the exact pinned minor-unit amount, in the plan's currency", async () => {
    await renewalThroughRealComposition();
    const create = outbound.find((call) => call.url.endsWith("/v1/payment_intents"));
    const form = new URLSearchParams(create?.body ?? "");
    expect(form.get("amount")).toBe("149900");
    expect(form.get("currency")).toBe("egp");
    expect(form.get("metadata[order_ref]")).toMatch(/^billing:/);
  });
});

describe("a billing charge shares nothing with a merchant-store payment", () => {
  it("creates no payment intent a store could read — for the merchant or the platform tenant", async () => {
    const { payments } = await renewalThroughRealComposition();

    for (const tenantId of [MERCHANT, PLATFORM]) {
      const byProviderId = await payments.payments.getPaymentIntent({
        tenantId,
        paymentIntentId: "pi_billing_1",
      });
      expect(byProviderId.status).toBe(404);
    }
  });

  it("the store's webhook handler does not accept the billing charge's events", async () => {
    const { payments } = await renewalThroughRealComposition();
    const payload = new TextEncoder().encode(
      JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" }),
    );
    const sign = (secret: string) => {
      const timestamp = Math.floor(Date.now() / 1000);
      const digest = createHmac("sha256", secret)
        .update(`${timestamp}.`)
        .update(payload)
        .digest("hex");
      return `t=${timestamp},v1=${digest}`;
    };

    // Sanity: the harness signs correctly — the STORE's own endpoint secret verifies.
    expect(
      await payments.payments.verifyWebhook({
        tenantId: MERCHANT,
        provider: "stripe",
        payload,
        signature: sign(STORE_WEBHOOK_SECRET),
      }),
    ).toBe(true);
    // A billing-endpoint-signed event is NOT authenticated by the store handler...
    expect(
      await payments.payments.verifyWebhook({
        tenantId: MERCHANT,
        provider: "stripe",
        payload,
        signature: sign(BILLING_WEBHOOK_SECRET),
      }),
    ).toBe(false);
    // ...and even a correctly-signed event that names the billing intent finds no store intent.
    for (const tenantId of [MERCHANT, PLATFORM]) {
      const recorded = await payments.payments.recordWebhook({
        tenantId,
        paymentIntentId: "pi_billing_1",
        provider: "stripe",
        eventId: "evt_1",
        kind: "captured",
      });
      expect(recorded.status).toBe(404);
    }
  });
});

/**
 * G-74 (1) — the same isolation guarantees for the SAVED-CARD path. A renewal that charges a merchant's
 * stored card goes out through MORBEH's Paymob account (never the merchant's own Paymob, which is
 * configured here on purpose), and the card-token callback that stores the card shares no secret, no
 * signing scheme, no route and no row with a merchant-store payment.
 */
const BILLING_PAYMOB_SECRET = "egy_sk_MORBEH_PAYMOB_BILLING";
const BILLING_PAYMOB_HMAC = "hmac_MORBEH_PAYMOB_BILLING";
const CARD_TOKEN = "3f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4";

const paymobBillingEnv = {
  ...validEnv,
  PLATFORM_BILLING_PAYMOB_SECRET_KEY: BILLING_PAYMOB_SECRET,
  PLATFORM_BILLING_PAYMOB_HMAC_SECRET: BILLING_PAYMOB_HMAC,
  PLATFORM_BILLING_PAYMOB_PUBLIC_KEY: "egy_pk_MORBEH_PAYMOB_BILLING",
  PLATFORM_BILLING_PAYMOB_INTEGRATION_ID: "4001",
  PLATFORM_BILLING_PAYMOB_MOTO_INTEGRATION_ID: "4002",
} as NodeJS.ProcessEnv;

/** A token callback for `orderId`, signed under Paymob's CARD-TOKEN scheme with `secret`. */
function signedTokenCallback(orderId: string, secret: string) {
  const obj = {
    id: 15978654,
    token: CARD_TOKEN,
    masked_pan: "xxxx-xxxx-xxxx-2346",
    merchant_id: 1053928,
    card_subtype: "MasterCard",
    created_at: "2026-08-24T13:28:31.015314",
    email: "merchant@example.test",
    order_id: orderId,
  };
  const concatenated =
    obj.card_subtype +
    obj.created_at +
    obj.email +
    String(obj.id) +
    obj.masked_pan +
    String(obj.merchant_id) +
    obj.order_id +
    obj.token;
  return {
    rawBody: new TextEncoder().encode(JSON.stringify({ type: "TOKEN", obj })),
    signature: createHmac("sha512", secret).update(concatenated).digest("hex"),
  };
}

async function savedCardRenewal() {
  const core = buildRuntimeCore(loadRuntimeConfig(paymobBillingEnv));
  expect(core.platformBillingStoredMethod).toBeDefined();

  // The MERCHANT has its own Paymob account, configured through WP-13's real per-tenant path.
  const payments = wirePayments({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    paymentProvider: core.paymentProvider,
    providerRegistrations: core.providerRegistrations,
    paymentCredentialVault: core.paymentCredentialVault,
  });
  await payments.payments.updateMerchantPaymentSettings({
    tenantId: MERCHANT,
    enabledMethods: ["stripe", "paymob"],
    providerSettings: {
      paymob: {
        config: { region: "egy", integrationId: 158, motoIntegrationId: 159 },
        credentials: {
          secretKey: MERCHANT_PAYMOB_KEY,
          hmacSecret: "hmac_merchant_own",
          publicKey: "egy_pk_merchant_own",
        },
      },
    },
  });

  const licensing = wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    platformTenantId: PLATFORM,
    ...(core.platformBillingPayments === undefined
      ? {}
      : { payments: core.platformBillingPayments }),
    ...(core.platformBillingStoredMethod === undefined
      ? {}
      : { storedMethodBilling: core.platformBillingStoredMethod }),
  });

  // Step 1: the merchant's interactive first payment (an issued invoice) starts on Morbeh's account.
  const invoice = await licensing.licensing.createInvoice({
    tenantRef: MERCHANT,
    subscriptionRef: "sub-first",
    currency: "EGP",
    lineItems: [{ description: "First period", amountMinor: 149900 }],
    tenantId: PLATFORM,
  });
  const invoiceId = (invoice.body as { id: string }).id;
  await licensing.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM });
  const begun = await licensing.licensing.beginCardEnrolment({ invoiceId, tenantId: PLATFORM });
  const orderId = (begun.body as { providerOrderId: string }).providerOrderId;

  // Step 2: Paymob's card-token callback, signed with MORBEH's billing HMAC secret.
  const callback = signedTokenCallback(orderId, BILLING_PAYMOB_HMAC);
  const recorded = await licensing.licensing.recordCardToken({ tenantId: PLATFORM, ...callback });

  // Step 3: the renewal charges the stored card.
  const plan = await licensing.licensing.createPlan({
    key: "growth",
    name: "Growth",
    tier: "growth",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await licensing.licensing.createPlanDraft({
    planId,
    tenantId: PLATFORM,
    spec: {
      limits: {},
      featureEntitlements: [],
      pricing: {
        basePriceMinor: 149900,
        currency: "EGP",
        billingCycle: "monthly",
        creditAllowances: {},
      },
    },
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  await licensing.licensing.publishPlanVersion({ planId, planVersionId, tenantId: PLATFORM });
  const subscription = await licensing.licensing.createSubscription({
    tenantRef: MERCHANT,
    planVersionRef: planVersionId,
    tenantId: PLATFORM,
  });
  const subscriptionId = (subscription.body as { id: string }).id;
  await licensing.licensing.activateSubscription({ subscriptionId, tenantId: PLATFORM });
  const renewal = await licensing.licensing.billSubscriptionRenewal({
    subscriptionId,
    tenantId: PLATFORM,
  });
  return { core, payments, licensing, orderId, recorded, renewal };
}

function stubPaymobWire(outboundCalls: OutboundCall[]) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    outboundCalls.push({
      url,
      authorization: headers["Authorization"],
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (url.endsWith("/v1/intention/")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { payment_methods: number[] };
      return new Response(
        JSON.stringify({
          intention_order_id: 900 + outboundCalls.length,
          client_secret: "csk_billing",
          payment_keys: [{ integration: body.payment_methods[0], key: "payment-key" }],
        }),
        { status: 201 },
      );
    }
    if (url.endsWith("/api/acceptance/payments/pay")) {
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
    }
    return new Response(JSON.stringify({ detail: `unexpected call ${url}` }), { status: 500 });
  });
}

describe("a saved-card renewal charges through MORBEH's Paymob account, never the merchant's", () => {
  it("collects the pinned price once, through the MOTO integration, on Morbeh's credentials only", async () => {
    stubPaymobWire(outbound);
    const { recorded, renewal } = await savedCardRenewal();

    expect(recorded.status).toBe(200);
    expect(renewal.status).toBe(200);
    expect((renewal.body as { status: string }).status).toBe("paid");

    const wire = JSON.stringify(outbound);
    expect(outbound.every((call) => call.url.startsWith("https://accept.paymob.com/"))).toBe(true);
    expect(outbound.some((call) => call.url.includes("stripe"))).toBe(false);
    expect(wire).not.toContain(MERCHANT_PAYMOB_KEY);
    expect(wire).not.toContain("hmac_merchant_own");
    expect(wire).not.toContain(STORE_STRIPE_KEY);
    // Every authorised call carries Morbeh's key; the pay call is authorised by its payment key.
    for (const call of outbound.filter((c) => c.authorization !== undefined)) {
      expect(call.authorization).toBe(`Token ${BILLING_PAYMOB_SECRET}`);
    }
    const intentions = outbound.filter((call) => call.url.endsWith("/v1/intention/"));
    expect(
      intentions.map(
        (call) => (JSON.parse(call.body ?? "{}") as { payment_methods: number[] }).payment_methods,
      ),
    ).toEqual([
      [4001], // the interactive first payment: the card integration
      [4002], // the renewal: the MOTO integration, never the card one
    ]);
    const pay = outbound.filter((call) => call.url.endsWith("/api/acceptance/payments/pay"));
    expect(pay).toHaveLength(1);
    // The token is on the wire exactly once — in the pay request that charges it.
    expect(wire.split(CARD_TOKEN)).toHaveLength(2);
  });

  it("stores the token sealed: the plaintext is nowhere in the record", async () => {
    stubPaymobWire(outbound);
    const { licensing } = await savedCardRenewal();
    const stored = await licensing.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM);
    expect(stored).not.toBeNull();
    expect(stored?.sealedTokenForCharge()).not.toContain(CARD_TOKEN);
    expect(JSON.stringify(stored)).not.toContain(CARD_TOKEN);
  });
});

describe("the saved-card callback shares nothing with a merchant-store payment", () => {
  it("a card-token callback signed with a MERCHANT's HMAC secret stores nothing", async () => {
    stubPaymobWire(outbound);
    const { licensing, orderId } = await savedCardRenewal();
    const forged = signedTokenCallback(orderId, "hmac_merchant_own");

    const response = await licensing.licensing.recordCardToken({
      tenantId: PLATFORM,
      ...forged,
    });

    expect(response.status).toBe(401);
  });

  it("the store's Paymob webhook handler does not authenticate a billing callback, and finds no intent for it", async () => {
    stubPaymobWire(outbound);
    const { payments, orderId } = await savedCardRenewal();
    const billingSigned = signedTokenCallback(orderId, BILLING_PAYMOB_HMAC);

    // The store verifies against the RECEIVING MERCHANT's own HMAC secret, by the transaction scheme.
    expect(
      await payments.payments.verifyWebhook({
        tenantId: MERCHANT,
        provider: "paymob",
        payload: billingSigned.rawBody,
        signature: billingSigned.signature,
      }),
    ).toBe(false);
    // Even a correctly-signed store event naming the billing order finds no store payment intent.
    for (const tenantId of [MERCHANT, PLATFORM]) {
      const recorded = await payments.payments.recordWebhook({
        tenantId,
        paymentIntentId: orderId,
        provider: "paymob",
        eventId: `${orderId}:captured`,
        kind: "captured",
      });
      expect(recorded.status).toBe(404);
    }
  });
});
