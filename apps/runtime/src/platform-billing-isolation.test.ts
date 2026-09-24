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
