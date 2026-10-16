import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing } from "./composition";
import type { PlanSpec } from "./domain/value-objects/plan-spec";
import { PlatformBillingPaymentsAdapter } from "./infrastructure/platform-billing-payments-adapter";
import { RecordingPaymentProvider } from "./test-support/recording-payment-provider";

/**
 * WP-14 (T14.2 + T14.4): the merchant cannot price their own bill, and a renewal charges the price
 * pinned on the subscription's immutable plan VERSION through the platform's PSP.
 */
const PLATFORM = "platform-tenant";
const MERCHANT_TENANT = "merchant-tenant";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function setup() {
  const time = { now: new Date("2026-10-01T00:00:00.000Z") };
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

function spec(basePriceMinor: number, currency = "EGP"): PlanSpec {
  return {
    limits: { maxProducts: 100 },
    featureEntitlements: ["basic_reports"],
    pricing: { basePriceMinor, currency, billingCycle: "monthly", creditAllowances: {} },
  };
}

async function publishedVersionWith(app: App, planId: string, planSpec: PlanSpec): Promise<string> {
  const draft = await app.licensing.createPlanDraft({ planId, spec: planSpec, tenantId: PLATFORM });
  expect(draft.status).toBe(201);
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  const published = await app.licensing.publishPlanVersion({
    planId,
    planVersionId,
    tenantId: PLATFORM,
  });
  expect(published.status).toBe(200);
  return planVersionId;
}

function publishedVersion(app: App, planId: string, price: number): Promise<string> {
  return publishedVersionWith(app, planId, spec(price));
}

async function newPlan(app: App, key = "growth"): Promise<string> {
  const plan = await app.licensing.createPlan({
    key,
    name: "Growth",
    tier: "growth",
    tenantId: PLATFORM,
  });
  expect(plan.status).toBe(201);
  return (plan.body as { id: string }).id;
}

async function activeSubscription(
  app: App,
  tenantRef: string,
  planVersionRef: string,
): Promise<string> {
  const created = await app.licensing.createSubscription({
    tenantRef,
    planVersionRef,
    tenantId: PLATFORM,
  });
  expect(created.status).toBe(201);
  const subscriptionId = (created.body as { id: string }).id;
  const activated = await app.licensing.activateSubscription({
    subscriptionId,
    tenantId: PLATFORM,
  });
  expect(activated.status).toBe(200);
  return subscriptionId;
}

describe("plan price changes never reach an existing subscription (DoD)", () => {
  it("bills the pinned version's price after the plan's price was changed", async () => {
    const { app, provider } = setup();
    const planId = await newPlan(app);
    const v1 = await publishedVersion(app, planId, 2900);
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);

    // Morbeh raises the price: a NEW version is published and becomes the plan's current one.
    const v2 = await publishedVersion(app, planId, 3900);
    expect(v2).not.toBe(v1);

    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect(renewal.status).toBe(200);
    expect((renewal.body as { status: string }).status).toBe("paid");
    expect(provider.moved).toHaveLength(1);
    expect(provider.moved[0]).toMatchObject({ amountMinor: 2900, currency: "EGP" });
  });

  it("a subscription created after the price change is charged the new price", async () => {
    const { app, provider } = setup();
    const planId = await newPlan(app);
    await publishedVersion(app, planId, 2900);
    const v2 = await publishedVersion(app, planId, 3900);
    const subscriptionId = await activeSubscription(app, "merchant-2", v2);

    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });

    expect(provider.moved[0]?.amountMinor).toBe(3900);
  });

  it("re-pinning is the ONLY way a subscription's price changes, and it is explicit", async () => {
    const { app, provider, time } = setup();
    const planId = await newPlan(app);
    const v1 = await publishedVersion(app, planId, 2900);
    const v2 = await publishedVersion(app, planId, 3900);
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });

    const repin = await app.licensing.repinSubscription({
      subscriptionId,
      newPlanVersionRef: v2,
      tenantId: PLATFORM,
    });
    expect(repin.status).toBe(200);
    time.now = new Date("2026-11-05T00:00:00.000Z");
    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });

    expect(provider.moved.map((m) => m.amountMinor)).toEqual([2900, 3900]);
  });
});

describe("a subscription pins a real, published platform plan version", () => {
  it("refuses a version ref that names no plan", async () => {
    const { app } = setup();
    const response = await app.licensing.createSubscription({
      tenantRef: "merchant-1",
      planVersionRef: "no-such-plan-v1",
      tenantId: PLATFORM,
    });
    expect(response.status).toBe(404);
  });

  it("refuses a draft version (only a published version can be sold)", async () => {
    const { app } = setup();
    const planId = await newPlan(app);
    const draft = await app.licensing.createPlanDraft({
      planId,
      spec: spec(2900),
      tenantId: PLATFORM,
    });
    const response = await app.licensing.createSubscription({
      tenantRef: "merchant-1",
      planVersionRef: (draft.body as { planVersionId: string }).planVersionId,
      tenantId: PLATFORM,
    });
    expect(response.status).toBe(409);
  });

  it("refuses to draft a version with a fractional or malformed-currency price", async () => {
    const { app } = setup();
    const planId = await newPlan(app);
    const fractional = await app.licensing.createPlanDraft({
      planId,
      spec: spec(29.99),
      tenantId: PLATFORM,
    });
    const badCurrency = await app.licensing.createPlanDraft({
      planId,
      spec: spec(2900, "egp"),
      tenantId: PLATFORM,
    });
    expect(fractional.status).toBe(409);
    expect(badCurrency.status).toBe(409);
  });
});

describe("a merchant tenant cannot price or grant its own subscription (Trap 2)", () => {
  it("refuses every platform-owned licensing operation from a non-platform tenant", async () => {
    const { app } = setup();
    const planId = await newPlan(app);
    const v1 = await publishedVersion(app, planId, 2900);
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);

    const attempts = await Promise.all([
      app.licensing.createPlan({
        key: "self-priced",
        name: "Mine",
        tier: "custom",
        tenantId: MERCHANT_TENANT,
      }),
      app.licensing.createPlanDraft({ planId, spec: spec(1), tenantId: MERCHANT_TENANT }),
      app.licensing.publishPlanVersion({ planId, planVersionId: v1, tenantId: MERCHANT_TENANT }),
      app.licensing.rollbackPlan({ planId, planVersionId: v1, tenantId: MERCHANT_TENANT }),
      app.licensing.createSubscription({
        tenantRef: MERCHANT_TENANT,
        planVersionRef: v1,
        tenantId: MERCHANT_TENANT,
      }),
      app.licensing.repinSubscription({
        subscriptionId,
        newPlanVersionRef: v1,
        tenantId: MERCHANT_TENANT,
      }),
      app.licensing.createInvoice({
        tenantRef: MERCHANT_TENANT,
        subscriptionRef: subscriptionId,
        currency: "EGP",
        lineItems: [{ description: "free", amountMinor: 1 }],
        tenantId: MERCHANT_TENANT,
      }),
      app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: MERCHANT_TENANT }),
      app.licensing.grantCredit({
        tenantRef: MERCHANT_TENANT,
        amount: 1_000_000,
        reason: "self grant",
        tenantId: MERCHANT_TENANT,
      }),
    ]);

    for (const response of attempts) expect(response.status).toBe(403);
  });

  it("the platform tenant is not restricted", async () => {
    const { app } = setup();
    const response = await app.licensing.createPlan({
      key: "ok",
      name: "Ok",
      tier: "starter",
      tenantId: PLATFORM,
    });
    expect(response.status).toBe(201);
  });
});

describe("renewal billing", () => {
  it("bills each period once: a second call in the same period is refused, one charge total", async () => {
    const { app, provider } = setup();
    const planId = await newPlan(app);
    const v1 = await publishedVersion(app, planId, 2900);
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);

    const first = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });
    const second = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(provider.moved).toHaveLength(1);
  });

  it("bills again once the next period is due", async () => {
    const { app, provider, time } = setup();
    const planId = await newPlan(app);
    const v1 = await publishedVersion(app, planId, 2900);
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });

    time.now = new Date("2026-11-05T00:00:00.000Z");
    const second = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect(second.status).toBe(200);
    expect(provider.moved).toHaveLength(2);
  });

  it("charges through the platform provider with a billing reference and the merchant as payer", async () => {
    const { app, provider } = setup();
    const planId = await newPlan(app);
    const v1 = await publishedVersion(app, planId, 2900);
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    await app.licensing.billSubscriptionRenewal({ subscriptionId, tenantId: PLATFORM });

    expect(provider.intentRequests).toHaveLength(1);
    expect(provider.intentRequests[0]?.tenantId).toBe("merchant-1");
    expect(provider.intentRequests[0]?.orderRef.startsWith("billing:")).toBe(true);
  });

  it("refuses a version with no billing currency (a legacy 'XXX' version is not billable)", async () => {
    const { app, provider } = setup();
    const planId = await newPlan(app);
    const legacy = await publishedVersionWith(app, planId, spec(2900, "XXX"));
    const subscriptionId = await activeSubscription(app, "merchant-1", legacy);

    const response = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect(response.status).toBe(409);
    expect(provider.intentRequests).toHaveLength(0);
  });
});

describe("CollectInvoice against the real adapter", () => {
  async function issuedInvoice(app: App, amountMinor = 2900): Promise<string> {
    const invoice = await app.licensing.createInvoice({
      tenantRef: "merchant-1",
      subscriptionRef: "sub-1",
      currency: "EGP",
      lineItems: [{ description: "Growth plan", amountMinor }],
      tenantId: PLATFORM,
    });
    const invoiceId = (invoice.body as { id: string }).id;
    await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM });
    return invoiceId;
  }

  it("collecting the same invoice twice charges once", async () => {
    const { app, provider } = setup();
    const invoiceId = await issuedInvoice(app);

    const first = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
    const second = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.moved).toHaveLength(1);
  });

  it("two racing collections of one invoice still move money once (same idempotency key)", async () => {
    const { app, provider } = setup();
    const invoiceId = await issuedInvoice(app);

    await Promise.all([
      app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM }),
      app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM }),
    ]);

    expect(provider.moved).toHaveLength(1);
  });

  it("a failed charge leaves the invoice failed, money unmoved, and re-issue available", async () => {
    const { app, provider } = setup();
    const invoiceId = await issuedInvoice(app);
    provider.declineCapture = true;

    await expect(app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM })).rejects.toThrow(
      "card declined",
    );
    expect(provider.moved).toHaveLength(0);

    // The invoice is `failed`: collecting it again is refused, naming the state.
    const stillFailed = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
    expect(stillFailed.status).toBe(409);
    expect(JSON.stringify(stillFailed.body)).toContain("failed");

    // failed -> issued stays available for a later retry (the schedule around it is T14.5).
    const reissued = await app.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM });
    expect(reissued.status).toBe(200);
    provider.declineCapture = false;
    const retried = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
    expect(retried.status).toBe(200);
    expect(provider.moved).toHaveLength(1);
  });

  it("a failed renewal reports failed without throwing and moves no money", async () => {
    const { app, provider } = setup();
    const planId = await newPlan(app);
    const v1 = await publishedVersion(app, planId, 2900);
    const subscriptionId = await activeSubscription(app, "merchant-1", v1);
    provider.declineCapture = true;

    const renewal = await app.licensing.billSubscriptionRenewal({
      subscriptionId,
      tenantId: PLATFORM,
    });

    expect(renewal.status).toBe(200);
    expect((renewal.body as { status: string }).status).toBe("failed");
    expect(provider.moved).toHaveLength(0);
  });

  it("refuses to collect a zero-total invoice instead of sending 0 to a PSP", async () => {
    const { app, provider } = setup();
    const invoiceId = await issuedInvoice(app, 0);
    const response = await app.licensing.collectInvoice({ invoiceId, tenantId: PLATFORM });
    expect(response.status).toBe(409);
    expect(provider.intentRequests).toHaveLength(0);
  });
});
