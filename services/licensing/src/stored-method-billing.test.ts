import { describe, expect, it, vi } from "vitest";
import type { Clock, IdGenerator, OffSessionChargeRequest } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type {
  BillingTokenSealer,
  CardEnrolmentPort,
  CardTokenCallbackVerifier,
  FinanceLedgerPort,
  VerifiedCardToken,
} from "./application/ports";
import { wireLicensing } from "./composition";
import type { PlanSpec } from "./domain/value-objects/plan-spec";

/**
 * WP-14 follow-up G-74 (1): Morbeh's renewals charge a merchant's SAVED card with no payer present.
 * The card token belongs to Morbeh's billing state — platform-scoped in `licensing`, sealed — and
 * never to the merchant's own tenant data (Trap 2). Everything the PSP does is doubled here; the
 * Paymob wire shapes are pinned in `packages/psp-paymob`, the real sealing in `apps/runtime`.
 */
const PLATFORM = "platform-tenant";
const MERCHANT_TENANT = "merchant-tenant";
const MERCHANT = "merchant-1";
const TOKEN = "3f22ce8a4e77125c70f0bc69830e34c36df469351e2fa6be76428be4";
const GOOD_HMAC = "valid-hmac";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

/** A PSP that dedupes on the idempotency key, the way the port's contract says a real one does. */
class FakeCharger {
  readonly calls: OffSessionChargeRequest[] = [];
  readonly moved = new Map<string, number>();
  chargeStoredMethod(request: OffSessionChargeRequest): Promise<{ providerReference: string }> {
    this.calls.push(request);
    if (!this.moved.has(request.idempotencyKey)) {
      this.moved.set(request.idempotencyKey, request.amountMinor);
    }
    return Promise.resolve({ providerReference: `psp-${request.idempotencyKey}` });
  }
}

/** Reversible, and bound to the payer like the real vault: a blob copied to another merchant does not open. */
const sealer: BillingTokenSealer = {
  backing: "real",
  seal: (tenantRef, token) =>
    Promise.resolve(`sealed(${tenantRef}):${Buffer.from(token).toString("base64")}`),
  open: (tenantRef, sealed) => {
    const prefix = `sealed(${tenantRef}):`;
    return sealed.startsWith(prefix)
      ? Promise.resolve(Buffer.from(sealed.slice(prefix.length), "base64").toString("utf8"))
      : Promise.reject(new Error("sealed blob does not open for this payer"));
  },
};

/** Accepts exactly one signature; a callback body is the `VerifiedCardToken` as JSON. */
const cardTokenVerifier: CardTokenCallbackVerifier = {
  verify: (rawBody, signature) =>
    signature === GOOD_HMAC
      ? (JSON.parse(new TextDecoder().decode(rawBody)) as VerifiedCardToken)
      : null,
};

function setup(overrides: { financeLedger?: FinanceLedgerPort } = {}) {
  const time = { now: new Date("2026-10-01T00:00:00.000Z") };
  const clock: Clock = { now: () => time.now };
  const charger = new FakeCharger();
  let orders = 0;
  const enrolments: { tenantRef: string; amountMinor: number; currency: string }[] = [];
  const enrolment: CardEnrolmentPort = {
    startCheckout: (request) => {
      orders += 1;
      enrolments.push({
        tenantRef: request.tenantRef,
        amountMinor: request.amountMinor,
        currency: request.currency,
      });
      return Promise.resolve({
        providerOrderId: `order-${orders}`,
        checkoutUrl: `https://pay.test/checkout/${orders}`,
      });
    },
  };
  const app = wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    platformTenantId: PLATFORM,
    ...(overrides.financeLedger === undefined ? {} : { financeLedger: overrides.financeLedger }),
    storedMethodBilling: { sealer, charger, enrolment, cardTokenVerifier },
  });
  return { app, charger, enrolments, time };
}
type App = ReturnType<typeof setup>["app"];

const spec = (basePriceMinor: number): PlanSpec => ({
  limits: { maxProducts: 100 },
  featureEntitlements: ["basic_reports"],
  pricing: { basePriceMinor, currency: "EGP", billingCycle: "monthly", creditAllowances: {} },
});

async function activeSubscription(app: App, tenantRef: string, price = 149900): Promise<string> {
  const plan = await app.licensing.createPlan({
    key: `growth-${tenantRef}`,
    name: "Growth",
    tier: "growth",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await app.licensing.createPlanDraft({
    planId,
    spec: spec(price),
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  await app.licensing.publishPlanVersion({ planId, planVersionId, tenantId: PLATFORM });
  const created = await app.licensing.createSubscription({
    tenantRef,
    planVersionRef: planVersionId,
    tenantId: PLATFORM,
  });
  const subscriptionId = (created.body as { id: string }).id;
  await app.licensing.activateSubscription({ subscriptionId, tenantId: PLATFORM });
  return subscriptionId;
}

async function issuedInvoice(app: App, tenantRef: string, amountMinor = 149900): Promise<string> {
  const created = await app.licensing.createInvoice({
    tenantRef,
    subscriptionRef: "sub-x",
    currency: "EGP",
    lineItems: [{ description: "First period", amountMinor }],
    tenantId: PLATFORM,
  });
  const invoiceId = (created.body as { id: string }).id;
  await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM });
  return invoiceId;
}

function callback(orderId: string, overrides: Partial<VerifiedCardToken> = {}): Uint8Array {
  const body: VerifiedCardToken = {
    tokenId: "token-1",
    token: TOKEN,
    providerOrderId: orderId,
    maskedPan: "xxxx-xxxx-xxxx-2346",
    cardSubtype: "MasterCard",
    ...overrides,
  };
  return new TextEncoder().encode(JSON.stringify(body));
}

/** The first, interactive payment: begin the checkout, then Paymob delivers the token callback. */
async function enrol(app: App, tenantRef: string, overrides: Partial<VerifiedCardToken> = {}) {
  const invoiceId = await issuedInvoice(app, tenantRef);
  const begun = await app.licensing.beginCardEnrolment({ invoiceId, tenantId: PLATFORM });
  expect(begun.status).toBe(200);
  const orderId = (begun.body as { providerOrderId: string }).providerOrderId;
  const recorded = await app.licensing.recordCardToken({
    tenantId: PLATFORM,
    rawBody: callback(orderId, overrides),
    signature: GOOD_HMAC,
  });
  return { begun, recorded, orderId, invoiceId };
}

describe("the first, interactive payment saves the merchant's card", () => {
  it("starts a checkout for the invoice's own amount — read server-side, never supplied by the caller", async () => {
    const { app, enrolments } = setup();
    const invoiceId = await issuedInvoice(app, MERCHANT, 149900);

    const begun = await app.licensing.beginCardEnrolment({ invoiceId, tenantId: PLATFORM });

    expect(begun.status).toBe(200);
    expect((begun.body as { checkoutUrl: string }).checkoutUrl).toMatch(/^https:\/\/pay\.test\//);
    expect(enrolments).toEqual([{ tenantRef: MERCHANT, amountMinor: 149900, currency: "EGP" }]);
  });

  it("stores the token from a verified callback against that merchant, and only sealed", async () => {
    const { app } = setup();
    const { recorded } = await enrol(app, MERCHANT);

    expect(recorded.status).toBe(200);
    const stored = await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM);
    expect(stored).not.toBeNull();
    expect(stored?.sealedTokenForCharge()).not.toContain(TOKEN);
    expect(stored?.sealedTokenForCharge()).toMatch(/^sealed\(merchant-1\):/);
  });

  it("refuses a callback whose signature does not verify: nothing is stored", async () => {
    const { app } = setup();
    const invoiceId = await issuedInvoice(app, MERCHANT);
    const begun = await app.licensing.beginCardEnrolment({ invoiceId, tenantId: PLATFORM });
    const orderId = (begun.body as { providerOrderId: string }).providerOrderId;

    const forged = await app.licensing.recordCardToken({
      tenantId: PLATFORM,
      rawBody: callback(orderId),
      signature: "forged",
    });

    expect(forged.status).toBe(401);
    expect(await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM)).toBeNull();
  });

  it("refuses a verified callback for an order nobody enrolled: nothing is stored", async () => {
    const { app } = setup();
    const stray = await app.licensing.recordCardToken({
      tenantId: PLATFORM,
      rawBody: callback("order-that-was-never-started"),
      signature: GOOD_HMAC,
    });
    expect(stray.status).toBe(404);
  });

  it("is idempotent on redelivery of the same token, and a newer card replaces the older one", async () => {
    const { app } = setup();
    const first = await enrol(app, MERCHANT);
    const replay = await app.licensing.recordCardToken({
      tenantId: PLATFORM,
      rawBody: callback(first.orderId),
      signature: GOOD_HMAC,
    });
    expect(replay.status).toBe(200);
    const afterReplay = await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM);

    const second = await enrol(app, MERCHANT, { tokenId: "token-2", token: "second-token-value" });
    expect(second.recorded.status).toBe(200);
    const active = await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM);

    expect(active?.id.toString()).not.toBe(afterReplay?.id.toString());
    expect(active?.maskedPan).toBe("xxxx-xxxx-xxxx-2346");
  });
});

describe("the stored token never appears in a DTO, a log line or a column", () => {
  it("is absent from every response and from the record's own serialisation", async () => {
    const { app } = setup();
    const { begun, recorded } = await enrol(app, MERCHANT);
    const stored = await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM);
    const sealed = stored?.sealedTokenForCharge() ?? "";

    for (const surface of [
      JSON.stringify(begun.body),
      JSON.stringify(recorded.body),
      JSON.stringify(stored),
      String(stored),
    ]) {
      expect(surface).not.toContain(TOKEN);
      expect(surface).not.toContain(Buffer.from(TOKEN).toString("base64"));
      expect(surface).not.toContain(sealed);
    }
  });

  it("is never logged while being recorded or charged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const { app } = setup();
      await enrol(app, MERCHANT);
      const subscriptionId = await activeSubscription(app, MERCHANT);
      await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });
      const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
      expect(logged).not.toContain(TOKEN);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

describe("a merchant cannot reach the token that bills them", () => {
  it("is invisible under the merchant's own tenant scope", async () => {
    const { app } = setup();
    await enrol(app, MERCHANT);

    expect(
      await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM),
    ).not.toBeNull();
    expect(
      await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, MERCHANT_TENANT),
    ).toBeNull();
  });

  it("cannot begin an enrolment, or revoke the method, from a merchant tenant (403)", async () => {
    const { app } = setup();
    await enrol(app, MERCHANT);
    const invoiceId = await issuedInvoice(app, MERCHANT);

    const begin = await app.licensing.beginCardEnrolment({ invoiceId, tenantId: MERCHANT_TENANT });
    const revoke = await app.licensing.revokeBillingPaymentMethod({
      tenantRef: MERCHANT,
      tenantId: MERCHANT_TENANT,
    });

    expect(begin.status).toBe(403);
    expect(revoke.status).toBe(403);
    expect(
      await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM),
    ).not.toBeNull();
  });

  it("cannot make a token callback land in its own tenant scope by naming that tenant", async () => {
    const { app } = setup();
    const invoiceId = await issuedInvoice(app, MERCHANT);
    const begun = await app.licensing.beginCardEnrolment({ invoiceId, tenantId: PLATFORM });
    const orderId = (begun.body as { providerOrderId: string }).providerOrderId;

    const recorded = await app.licensing.recordCardToken({
      tenantId: MERCHANT_TENANT,
      rawBody: callback(orderId),
      signature: GOOD_HMAC,
    });

    expect(recorded.status).toBe(200);
    expect(
      await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM),
    ).not.toBeNull();
    expect(
      await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, MERCHANT_TENANT),
    ).toBeNull();
  });

  it("the platform operator can revoke it, after which the merchant has no card on file", async () => {
    const { app } = setup();
    await enrol(app, MERCHANT);

    const revoked = await app.licensing.revokeBillingPaymentMethod({
      tenantRef: MERCHANT,
      tenantId: PLATFORM,
    });

    expect(revoked.status).toBe(200);
    expect(await app.billingPaymentMethods.findActiveByTenantRef(MERCHANT, PLATFORM)).toBeNull();
  });
});

describe("a renewal charges the stored token", () => {
  it("moves the pinned price exactly once and records the PSP's reference on the invoice", async () => {
    const { app, charger } = setup();
    await enrol(app, MERCHANT);
    const subscriptionId = await activeSubscription(app, MERCHANT, 149900);

    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect(renewal.status).toBe(200);
    const { invoiceId, status } = renewal.body as { invoiceId: string; status: string };
    expect(status).toBe("paid");
    expect(charger.calls).toHaveLength(1);
    expect(charger.calls[0]).toMatchObject({
      tenantId: MERCHANT,
      amountMinor: 149900,
      currency: "EGP",
      storedMethodToken: TOKEN,
    });
    expect(charger.calls[0]?.idempotencyKey).toMatch(new RegExp(`^${invoiceId}:\\d+:collect$`));
    expect([...charger.moved.values()]).toEqual([149900]);
  });

  it("a retry or a racing second collect presents the same key, so the PSP moves the money once", async () => {
    const { app, charger } = setup();
    await enrol(app, MERCHANT);
    const invoiceId = await issuedInvoice(app, MERCHANT, 5000);

    await Promise.all([
      app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM }),
      app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM }),
    ]);
    await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });

    expect(new Set(charger.calls.map((call) => call.idempotencyKey)).size).toBe(1);
    expect(charger.moved.size).toBe(1);
    expect([...charger.moved.values()]).toEqual([5000]);
  });

  it("charges only the merchant's own token, never another merchant's", async () => {
    const { app, charger } = setup();
    await enrol(app, "merchant-a", { token: "token-of-a", tokenId: "ta" });
    await enrol(app, "merchant-b", { token: "token-of-b", tokenId: "tb" });
    const subscriptionId = await activeSubscription(app, "merchant-b");

    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });

    expect(charger.calls.map((call) => call.storedMethodToken)).toEqual(["token-of-b"]);
  });
});

describe("a merchant with no stored token is not silently skipped", () => {
  it("fails the invoice visibly, attempts no charge and reports no collection", async () => {
    const postSettlement = vi.fn(() => Promise.resolve());
    const { app, charger } = setup({ financeLedger: { postSettlement } });
    const subscriptionId = await activeSubscription(app, MERCHANT); // never enrolled a card

    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect(renewal.status).toBe(200);
    expect((renewal.body as { status: string }).status).toBe("failed");
    expect(charger.calls).toHaveLength(0);
    expect(postSettlement).not.toHaveBeenCalled();
  });

  it("treats a revoked method exactly like no method", async () => {
    const postSettlement = vi.fn(() => Promise.resolve());
    const { app, charger } = setup({ financeLedger: { postSettlement } });
    await enrol(app, MERCHANT);
    await app.licensing.revokeBillingPaymentMethod({ tenantRef: MERCHANT, tenantId: PLATFORM });
    const subscriptionId = await activeSubscription(app, MERCHANT);

    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect((renewal.body as { status: string }).status).toBe("failed");
    expect(charger.calls).toHaveLength(0);
    expect(postSettlement).not.toHaveBeenCalled();
  });
});
