import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing } from "./composition";
import type { CouponValue } from "./domain/coupon";
import type { PlanSpec } from "./domain/value-objects/plan-spec";
import { PlatformBillingPaymentsAdapter } from "./infrastructure/platform-billing-payments-adapter";
import { RecordingPaymentProvider } from "./test-support/recording-payment-provider";

/**
 * WP-14 T14.3 (first half): coupons reduce what Morbeh CHARGES. Everything here goes through
 * `LicensingController` and ends at the PSP boundary (`RecordingPaymentProvider`), because the number
 * that matters is the one the payment provider is asked to move, not the one on the invoice row.
 */
const PLATFORM = "platform-tenant";
const MERCHANT_TENANT = "merchant-tenant";
const START = new Date("2026-10-01T00:00:00.000Z");
const IN_A_MONTH = new Date("2026-11-01T00:00:00.000Z");
const PAST_EXPIRY = new Date("2026-11-02T00:00:00.000Z");

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function setup() {
  const time = { now: START };
  const clock: Clock = { now: () => time.now };
  const provider = new RecordingPaymentProvider();
  const app = wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    platformTenantId: PLATFORM,
    payments: new PlatformBillingPaymentsAdapter({ provider }),
  });
  return { app, provider, time };
}
type App = ReturnType<typeof setup>["app"];

const PERCENT_20: CouponValue = { kind: "percentage", basisPoints: 2000 };
const PERCENT_100: CouponValue = { kind: "percentage", basisPoints: 10000 };

async function issueCoupon(
  app: App,
  code: string,
  value: CouponValue = PERCENT_20,
  extra: { merchantRef?: string; expiresAt?: Date } = {},
): Promise<string> {
  const issued = await app.licensing.issueCoupon({
    code,
    value,
    expiresAt: extra.expiresAt ?? IN_A_MONTH,
    ...(extra.merchantRef === undefined ? {} : { merchantRef: extra.merchantRef }),
    tenantId: PLATFORM,
  });
  expect(issued.status).toBe(201);
  return (issued.body as { id: string }).id;
}

async function draftInvoice(
  app: App,
  amountMinor = 2900,
  currency = "EGP",
  tenantRef = "merchant-1",
): Promise<string> {
  const created = await app.licensing.createInvoice({
    tenantRef,
    subscriptionRef: "sub-1",
    currency,
    lineItems: [{ description: "Growth plan", amountMinor }],
    tenantId: PLATFORM,
  });
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id;
}

function redeem(app: App, code: string, invoiceId: string, tenantId = PLATFORM) {
  return app.licensing.redeemCoupon({ code, invoiceId, tenantId });
}

async function issueAndCollect(app: App, invoiceId: string) {
  expect((await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM })).status).toBe(200);
  return app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
}

describe("coupon issuance is platform-only (D-062 Trap 2)", () => {
  it("refuses a merchant tenant 403 when it issues itself a 100% coupon, and issues nothing", async () => {
    const { app } = setup();
    const refused = await app.licensing.issueCoupon({
      code: "FREEBIE",
      value: PERCENT_100,
      expiresAt: IN_A_MONTH,
      tenantId: MERCHANT_TENANT,
    });
    expect(refused.status).toBe(403);
    // Nothing was written: the platform can still issue that very code (a duplicate would be 409).
    const issued = await app.licensing.issueCoupon({
      code: "FREEBIE",
      value: PERCENT_100,
      expiresAt: IN_A_MONTH,
      tenantId: PLATFORM,
    });
    expect(issued.status).toBe(201);
  });

  it("refuses a merchant tenant 403 for redeem, expire and revoke too", async () => {
    const { app, time } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    const invoiceId = await draftInvoice(app);
    time.now = PAST_EXPIRY;
    expect((await redeem(app, "LAUNCH20", invoiceId, MERCHANT_TENANT)).status).toBe(403);
    expect((await app.licensing.expireCoupon({ couponId, tenantId: MERCHANT_TENANT })).status).toBe(
      403,
    );
    expect(
      (await app.licensing.revokeCoupon({ couponId, reason: "x", tenantId: MERCHANT_TENANT }))
        .status,
    ).toBe(403);
  });
});

describe("a redeemed coupon reduces what reaches the PSP", () => {
  it("charges the DISCOUNTED total, asserted at the payment boundary", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "LAUNCH20");
    const invoiceId = await draftInvoice(app, 2900);

    const redeemed = await redeem(app, "LAUNCH20", invoiceId);
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ discountMinor: 580, totalMinor: 2320 });

    expect((await issueAndCollect(app, invoiceId)).status).toBe(200);
    expect(provider.intentRequests).toHaveLength(1);
    expect(provider.intentRequests[0]?.amountMinor).toBe(2320);
    expect(provider.moved).toHaveLength(1);
    expect(provider.moved[0]).toMatchObject({ amountMinor: 2320, currency: "EGP" });
  });

  it("a fixed-amount coupon in the invoice's currency subtracts its face value", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "FIVEOFF", { kind: "fixed", amountMinor: 500, currency: "EGP" });
    const invoiceId = await draftInvoice(app, 2900);
    expect((await redeem(app, "FIVEOFF", invoiceId)).status).toBe(200);
    await issueAndCollect(app, invoiceId);
    expect(provider.moved[0]?.amountMinor).toBe(2400);
  });

  it("without a coupon the full price still reaches the PSP (the control)", async () => {
    const { app, provider } = setup();
    const invoiceId = await draftInvoice(app, 2900);
    await issueAndCollect(app, invoiceId);
    expect(provider.moved[0]?.amountMinor).toBe(2900);
  });
});

describe("a coupon that cannot apply is refused loudly and changes nothing", () => {
  it("a fixed coupon worth more than the invoice: 409, invoice untouched, coupon still redeemable", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "BIGONE", { kind: "fixed", amountMinor: 5000, currency: "EGP" });
    const small = await draftInvoice(app, 2900);
    const refused = await redeem(app, "BIGONE", small);
    expect(refused.status).toBe(409);

    // Nothing was floored to zero: the invoice still charges its full price...
    await issueAndCollect(app, small);
    expect(provider.moved[0]?.amountMinor).toBe(2900);

    // ...and the coupon was not consumed by the refusal: it redeems on an invoice it fits.
    const big = await draftInvoice(app, 9000);
    expect((await redeem(app, "BIGONE", big)).status).toBe(200);
  });

  it("a fixed coupon in the wrong currency is refused, never converted", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "USDOFF", { kind: "fixed", amountMinor: 500, currency: "USD" });
    const invoiceId = await draftInvoice(app, 2900, "EGP");
    const refused = await redeem(app, "USDOFF", invoiceId);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/currency/i);
    await issueAndCollect(app, invoiceId);
    expect(provider.moved[0]?.amountMinor).toBe(2900);
  });

  it("an unknown code is a 404", async () => {
    const { app } = setup();
    const invoiceId = await draftInvoice(app);
    expect((await redeem(app, "NOSUCHCODE", invoiceId)).status).toBe(404);
  });

  it("an unknown invoice is a 404 and does not consume the coupon", async () => {
    const { app } = setup();
    await issueCoupon(app, "LAUNCH20");
    expect((await redeem(app, "LAUNCH20", "no-such-invoice")).status).toBe(404);
    const invoiceId = await draftInvoice(app);
    expect((await redeem(app, "LAUNCH20", invoiceId)).status).toBe(200);
  });

  it("a coupon addressed to one merchant is refused on another merchant's invoice", async () => {
    const { app } = setup();
    await issueCoupon(app, "ONLYFORONE", PERCENT_20, { merchantRef: "merchant-1" });
    const other = await draftInvoice(app, 2900, "EGP", "merchant-2");
    expect((await redeem(app, "ONLYFORONE", other)).status).toBe(409);
    const own = await draftInvoice(app, 2900, "EGP", "merchant-1");
    expect((await redeem(app, "ONLYFORONE", own)).status).toBe(200);
  });

  it("a duplicate code is refused (409)", async () => {
    const { app } = setup();
    await issueCoupon(app, "LAUNCH20");
    const again = await app.licensing.issueCoupon({
      code: "launch20",
      value: PERCENT_20,
      expiresAt: IN_A_MONTH,
      tenantId: PLATFORM,
    });
    expect(again.status).toBe(409);
  });
});

describe("a discount is applied BEFORE issue — never to an issued invoice", () => {
  it("refuses a coupon on an issued invoice, keeps the total, and leaves the coupon unspent", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "LAUNCH20");
    const invoiceId = await draftInvoice(app, 2900);
    expect((await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM })).status).toBe(200);

    const refused = await redeem(app, "LAUNCH20", invoiceId);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/draft/i);

    await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
    expect(provider.moved[0]?.amountMinor).toBe(2900);

    const next = await draftInvoice(app, 2900);
    expect((await redeem(app, "LAUNCH20", next)).status).toBe(200);
  });
});

describe("redeem-once, expiry and revocation through the controller", () => {
  it("a redeemed coupon cannot be redeemed again — on the same invoice or another", async () => {
    const { app } = setup();
    await issueCoupon(app, "LAUNCH20");
    const first = await draftInvoice(app);
    const second = await draftInvoice(app);
    expect((await redeem(app, "LAUNCH20", first)).status).toBe(200);
    expect((await redeem(app, "LAUNCH20", first)).status).toBe(409);
    expect((await redeem(app, "LAUNCH20", second)).status).toBe(409);
  });

  it("an expired coupon cannot be redeemed, whether or not it was marked expired", async () => {
    const { app, time } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    const invoiceId = await draftInvoice(app);
    time.now = PAST_EXPIRY;
    expect((await redeem(app, "LAUNCH20", invoiceId)).status).toBe(409);
    expect((await app.licensing.expireCoupon({ couponId, tenantId: PLATFORM })).status).toBe(200);
    expect((await redeem(app, "LAUNCH20", invoiceId)).status).toBe(409);
  });

  it("expiring a coupon before its expiry is refused", async () => {
    const { app } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    expect((await app.licensing.expireCoupon({ couponId, tenantId: PLATFORM })).status).toBe(409);
  });

  it("a revoked coupon cannot be redeemed", async () => {
    const { app } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    const invoiceId = await draftInvoice(app);
    const revoked = await app.licensing.revokeCoupon({
      couponId,
      reason: "issued in error",
      tenantId: PLATFORM,
    });
    expect(revoked.status).toBe(200);
    expect((await redeem(app, "LAUNCH20", invoiceId)).status).toBe(409);
  });

  it("a redeemed coupon cannot be revoked or expired (the machine has no edge out of `redeemed`)", async () => {
    const { app, time } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    await redeem(app, "LAUNCH20", await draftInvoice(app));
    time.now = PAST_EXPIRY;
    expect(
      (await app.licensing.revokeCoupon({ couponId, reason: "x", tenantId: PLATFORM })).status,
    ).toBe(409);
    expect((await app.licensing.expireCoupon({ couponId, tenantId: PLATFORM })).status).toBe(409);
  });

  it("an unknown coupon id is a 404", async () => {
    const { app } = setup();
    expect(
      (await app.licensing.revokeCoupon({ couponId: "nope", reason: "x", tenantId: PLATFORM }))
        .status,
    ).toBe(404);
    expect(
      (await app.licensing.expireCoupon({ couponId: "nope", tenantId: PLATFORM })).status,
    ).toBe(404);
  });
});

describe("a 100% coupon: the invoice settles `paid` with NO PSP call", () => {
  it("settles a fully discounted invoice without asking the PSP to move anything", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "FREEMONTH", PERCENT_100);
    const invoiceId = await draftInvoice(app, 2900);
    expect(await redeem(app, "FREEMONTH", invoiceId)).toMatchObject({
      status: 200,
      body: { discountMinor: 2900, totalMinor: 0 },
    });

    expect((await issueAndCollect(app, invoiceId)).status).toBe(200);
    expect(provider.intentRequests).toHaveLength(0);
    expect(provider.captureCalls).toHaveLength(0);
    expect(provider.moved).toHaveLength(0);

    // It is genuinely `paid`: collecting again is an idempotent success, and the machine has no
    // edge out of `paid`, so it cannot be re-issued.
    expect((await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM })).status).toBe(
      200,
    );
    expect((await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM })).status).toBe(409);
    expect(provider.moved).toHaveLength(0);
  });

  it("a zero-total invoice that was NOT discounted is still refused (only a discount earns `paid` for free)", async () => {
    const { app, provider } = setup();
    const created = await app.licensing.createInvoice({
      tenantRef: "merchant-1",
      subscriptionRef: "sub-1",
      currency: "EGP",
      lineItems: [{ description: "nothing", amountMinor: 0 }],
      tenantId: PLATFORM,
    });
    const invoiceId = (created.body as { id: string }).id;
    await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM });
    const refused = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
    expect(refused.status).toBe(409);
    expect(provider.intentRequests).toHaveLength(0);
  });
});

/**
 * Renewals create-and-issue an invoice in ONE transaction, so there is no window for an operator to
 * redeem into it: a coupon only reduces a recurring charge if `BillSubscriptionRenewal` applies it
 * before issuing. Only a coupon ADDRESSED to the merchant is auto-applied (a bearer coupon is a code
 * someone presents), and one that cannot apply is SKIPPED — renewal billing is never blocked by a
 * coupon. Explicit `redeemCoupon` stays strict (refuses loudly, above).
 */
describe("coupons on scheduled renewals", () => {
  function spec(basePriceMinor: number, currency = "EGP"): PlanSpec {
    return {
      limits: { maxProducts: 100 },
      featureEntitlements: ["basic_reports"],
      pricing: { basePriceMinor, currency, billingCycle: "monthly", creditAllowances: {} },
    };
  }

  async function dueSubscription(
    app: App,
    tenantRef = "merchant-1",
    price = 2900,
    currency = "EGP",
  ) {
    const plan = await app.licensing.createPlan({
      key: `growth-${tenantRef}`,
      name: "Growth",
      tier: "growth",
      tenantId: PLATFORM,
    });
    const planId = (plan.body as { id: string }).id;
    const draft = await app.licensing.createPlanDraft({
      planId,
      spec: spec(price, currency),
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

  it("applies the merchant's addressed coupon, and the PSP is asked for the discounted amount", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "LAUNCH20", PERCENT_20, { merchantRef: "merchant-1" });
    const subscriptionId = await dueSubscription(app);
    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });
    expect(renewal.status).toBe(200);
    expect(provider.moved).toHaveLength(1);
    expect(provider.moved[0]?.amountMinor).toBe(2320);
    // Spent: a second explicit redemption is refused.
    expect((await redeem(app, "LAUNCH20", await draftInvoice(app))).status).toBe(409);
  });

  it("a 100% coupon makes the renewal `paid` with no PSP call", async () => {
    const { app, provider } = setup();
    await issueCoupon(app, "FREEMONTH", PERCENT_100, { merchantRef: "merchant-1" });
    const subscriptionId = await dueSubscription(app);
    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });
    expect(renewal.status).toBe(200);
    expect((renewal.body as { status: string }).status).toBe("paid");
    expect(provider.intentRequests).toHaveLength(0);
    expect(provider.moved).toHaveLength(0);
  });

  it("uses at most one coupon per renewal, oldest first, leaving the next unspent", async () => {
    const { app, provider } = setup();
    await issueCoupon(
      app,
      "FIRST",
      { kind: "fixed", amountMinor: 100, currency: "EGP" },
      {
        merchantRef: "merchant-1",
      },
    );
    const secondId = await issueCoupon(app, "SECOND", PERCENT_20, { merchantRef: "merchant-1" });
    const subscriptionId = await dueSubscription(app);
    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });
    expect(provider.moved[0]?.amountMinor).toBe(2800);
    expect(
      (await app.licensing.revokeCoupon({ couponId: secondId, reason: "x", tenantId: PLATFORM }))
        .status,
    ).toBe(200);
  });

  it("skips a coupon that cannot apply and bills full price: renewal is never blocked by a coupon", async () => {
    const { app, provider } = setup();
    const tooBig = await issueCoupon(
      app,
      "TOOBIG",
      { kind: "fixed", amountMinor: 5000, currency: "EGP" },
      { merchantRef: "merchant-1" },
    );
    const wrongCurrency = await issueCoupon(
      app,
      "WRONGCUR",
      { kind: "fixed", amountMinor: 100, currency: "USD" },
      { merchantRef: "merchant-1" },
    );
    const subscriptionId = await dueSubscription(app);
    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });
    expect(renewal.status).toBe(200);
    expect(provider.moved[0]?.amountMinor).toBe(2900);
    // Both are still unspent (revocable = still `issued`).
    for (const couponId of [tooBig, wrongCurrency]) {
      expect(
        (await app.licensing.revokeCoupon({ couponId, reason: "x", tenantId: PLATFORM })).status,
      ).toBe(200);
    }
  });

  it("does not apply another merchant's coupon, a bearer coupon, or an expired one", async () => {
    const { app, provider, time } = setup();
    await issueCoupon(app, "OTHERS", PERCENT_20, { merchantRef: "merchant-2" });
    await issueCoupon(app, "BEARER", PERCENT_20);
    await issueCoupon(app, "STALE", PERCENT_20, {
      merchantRef: "merchant-1",
      expiresAt: new Date("2026-10-15T00:00:00.000Z"),
    });
    const subscriptionId = await dueSubscription(app);
    time.now = new Date("2026-10-20T00:00:00.000Z");
    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });
    expect(provider.moved[0]?.amountMinor).toBe(2900);
  });
});

describe("an operator can read a coupon (T14.3, the read that makes issuance operable)", () => {
  const read = (app: App, couponId: string, tenantId = PLATFORM) =>
    app.licensing.getCoupon({ couponId, tenantId });

  it("shows an issued coupon with its value, expiry and addressee", async () => {
    const { app } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20", PERCENT_20, { merchantRef: "merchant-1" });
    const res = await read(app, couponId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: couponId,
      code: "LAUNCH20",
      value: PERCENT_20,
      expiresAt: IN_A_MONTH.toISOString(),
      merchantRef: "merchant-1",
      status: "issued",
      pastExpiry: false,
    });
  });

  it("names the invoice a redeemed coupon was spent on", async () => {
    const { app } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    const invoiceId = await draftInvoice(app);
    expect((await redeem(app, "LAUNCH20", invoiceId)).status).toBe(200);
    const res = await read(app, couponId);
    expect(res.body).toMatchObject({
      status: "redeemed",
      redemption: { invoiceRef: invoiceId, redeemedAt: START.toISOString() },
    });
  });

  it("shows a revoked coupon's reason", async () => {
    const { app } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    await app.licensing.revokeCoupon({ couponId, reason: "issued in error", tenantId: PLATFORM });
    expect((await read(app, couponId)).body).toMatchObject({
      status: "revoked",
      revokedReason: "issued in error",
    });
  });

  it("flags an unswept coupon past its expiry, which `status` alone would call issued", async () => {
    const { app, time } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    time.now = PAST_EXPIRY;
    expect((await read(app, couponId)).body).toMatchObject({ status: "issued", pastExpiry: true });
  });

  it("answers 404 for an unknown coupon", async () => {
    const { app } = setup();
    expect((await read(app, "no-such-coupon")).status).toBe(404);
  });

  it("refuses a merchant tenant 403 — the read would otherwise be an oracle for coupon ids", async () => {
    const { app } = setup();
    const couponId = await issueCoupon(app, "LAUNCH20");
    expect((await read(app, couponId, MERCHANT_TENANT)).status).toBe(403);
  });
});
