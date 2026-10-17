import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing } from "../composition";
import type { PlanSpec } from "../domain/value-objects/plan-spec";
import type { MerchantBillingView, MerchantPlanView } from "./merchant-billing.use-cases";

const PLATFORM = "tenant-platform";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-10-16T00:00:00.000Z") };

function wire() {
  return wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    platformTenantId: PLATFORM,
  });
}

function spec(basePriceMinor: number): PlanSpec {
  return {
    limits: { maxProducts: 100 },
    featureEntitlements: ["basic_reports"],
    pricing: {
      basePriceMinor,
      currency: "EGP",
      billingCycle: "monthly",
      trialDays: 14,
      creditAllowances: {},
    },
  };
}

type App = ReturnType<typeof wire>;

/** createPlan -> createPlanDraft [-> publishPlanVersion], all under the platform scope. */
async function seedPlan(
  app: App,
  key: string,
  basePriceMinor: number,
  options: { readonly publish: boolean } = { publish: true },
): Promise<{ planId: string; planVersionId: string }> {
  const plan = await app.licensing.createPlan({
    key,
    name: key === "basic" ? "Basic" : key.toUpperCase(),
    tier: "starter",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await app.licensing.createPlanDraft({
    planId,
    spec: spec(basePriceMinor),
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  if (options.publish) {
    const published = await app.licensing.publishPlanVersion({
      planId,
      planVersionId,
      tenantId: PLATFORM,
    });
    expect(published.status).toBe(200);
  }
  return { planId, planVersionId };
}

async function subscribe(app: App, tenantRef: string, planVersionRef: string): Promise<string> {
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

async function billing(app: App, tenantRef: string): Promise<MerchantBillingView> {
  const response = await app.licensing.getMerchantBilling({ tenantRef, tenantId: PLATFORM });
  expect(response.status).toBe(200);
  return response.body as MerchantBillingView;
}

describe("merchant billing (platform-owned data, read and changed by the merchant's own ref)", () => {
  it("resolveDefaultPlanVersion returns the published version; unknown key and unpublished plan are 404", async () => {
    const app = wire();
    const { planVersionId } = await seedPlan(app, "basic", 29900);
    await seedPlan(app, "draft-only", 5000, { publish: false });

    const found = await app.licensing.resolveDefaultPlanVersion({ planKey: "basic" });
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ planVersionRef: planVersionId });

    const unknown = await app.licensing.resolveDefaultPlanVersion({ planKey: "nope" });
    expect(unknown.status).toBe(404);
    const unpublished = await app.licensing.resolveDefaultPlanVersion({ planKey: "draft-only" });
    expect(unpublished.status).toBe(404);
  });

  it("an activated trial subscription shows its plan, status and the trial end as the next charge", async () => {
    const app = wire();
    const { planVersionId } = await seedPlan(app, "basic", 29900);
    await subscribe(app, "shop-a", planVersionId);

    const view = await billing(app, "shop-a");
    expect(view.plan).toEqual({
      key: "basic",
      name: "Basic",
      planVersionRef: planVersionId,
      priceMinor: 29900,
      currency: "EGP",
      billingCycle: "monthly",
      trialDays: 14,
    });
    expect(view.status).toBe("active");
    expect(view.nextChargeAt).toBe("2026-10-30T00:00:00.000Z");
    expect(view.trialEndsAt).toBe(view.nextChargeAt);
    expect(view.cardOnFile).toBe(false);
    expect(view.invoices).toEqual([]);
  });

  it("a merchant with no subscription gets an empty view, never another merchant's data", async () => {
    const app = wire();
    const { planVersionId } = await seedPlan(app, "basic", 29900);
    await subscribe(app, "shop-a", planVersionId);

    const view = await billing(app, "shop-b");
    expect(view).toEqual({
      plan: null,
      status: null,
      nextChargeAt: null,
      trialEndsAt: null,
      cardOnFile: false,
      invoices: [],
    });
  });

  it("once an invoice exists the trial is over and the invoice is listed for its own merchant only", async () => {
    const app = wire();
    const { planVersionId } = await seedPlan(app, "basic", 29900);
    const subscriptionId = await subscribe(app, "shop-a", planVersionId);
    const created = await app.licensing.createInvoice({
      tenantRef: "shop-a",
      subscriptionRef: subscriptionId,
      currency: "EGP",
      lineItems: [{ description: "Basic", amountMinor: 29900 }],
      tenantId: PLATFORM,
    });
    expect(created.status).toBe(201);
    const invoiceId = (created.body as { id: string }).id;

    const shopA = await billing(app, "shop-a");
    expect(shopA.trialEndsAt).toBeNull();
    expect(shopA.nextChargeAt).toBe("2026-10-30T00:00:00.000Z");
    expect(shopA.invoices).toEqual([
      {
        id: invoiceId,
        status: "draft",
        totalMinor: 29900,
        currency: "EGP",
        createdAt: "2026-10-16T00:00:00.000Z",
      },
    ]);
    expect((await billing(app, "shop-b")).invoices).toEqual([]);
  });

  it("lists invoices newest first", async () => {
    const app = wire();
    const { planVersionId } = await seedPlan(app, "basic", 29900);
    const subscriptionId = await subscribe(app, "shop-a", planVersionId);
    const ids: string[] = [];
    for (const amountMinor of [100, 200, 300]) {
      const created = await app.licensing.createInvoice({
        tenantRef: "shop-a",
        subscriptionRef: subscriptionId,
        currency: "EGP",
        lineItems: [{ description: "x", amountMinor }],
        tenantId: PLATFORM,
      });
      ids.push((created.body as { id: string }).id);
    }
    const view = await billing(app, "shop-a");
    expect(view.invoices.map((invoice) => invoice.id)).toEqual([...ids].reverse());
  });

  it("listPublishedPlans lists published plans by price and omits a draft-only plan", async () => {
    const app = wire();
    const pro = await seedPlan(app, "pro", 99900);
    const basic = await seedPlan(app, "basic", 29900);
    await seedPlan(app, "draft-only", 5000, { publish: false });

    const response = await app.licensing.listPublishedPlans();
    expect(response.status).toBe(200);
    const plans = response.body as readonly MerchantPlanView[];
    expect(plans.map((plan) => plan.key)).toEqual(["basic", "pro"]);
    expect(plans.map((plan) => plan.planVersionRef)).toEqual([
      basic.planVersionId,
      pro.planVersionId,
    ]);
    expect(plans[0]?.priceMinor).toBe(29900);
  });

  it("changeMerchantPlan re-pins the merchant's own subscription to the published version", async () => {
    const app = wire();
    const basic = await seedPlan(app, "basic", 29900);
    const pro = await seedPlan(app, "pro", 99900);
    await subscribe(app, "shop-a", basic.planVersionId);

    const changed = await app.licensing.changeMerchantPlan({
      tenantRef: "shop-a",
      tenantId: PLATFORM,
      planKey: "pro",
    });
    expect(changed.status).toBe(200);
    const view = await billing(app, "shop-a");
    expect(view.plan?.key).toBe("pro");
    expect(view.plan?.planVersionRef).toBe(pro.planVersionId);
    expect(view.plan?.priceMinor).toBe(99900);

    const unknown = await app.licensing.changeMerchantPlan({
      tenantRef: "shop-a",
      tenantId: PLATFORM,
      planKey: "nope",
    });
    expect(unknown.status).toBe(404);

    const noSubscription = await app.licensing.changeMerchantPlan({
      tenantRef: "shop-b",
      tenantId: PLATFORM,
      planKey: "pro",
    });
    expect(noSubscription.status).toBe(404);
    expect((await billing(app, "shop-b")).plan).toBeNull();
  });

  it("findMerchantSubscription names the merchant's subscription id and status, platform-only", async () => {
    const app = wire();
    const { planVersionId } = await seedPlan(app, "basic", 29900);
    const created = await app.licensing.createSubscription({
      tenantRef: "shop-a",
      planVersionRef: planVersionId,
      tenantId: PLATFORM,
    });
    const id = (created.body as { id: string }).id;

    const found = await app.licensing.findMerchantSubscription({
      tenantRef: "shop-a",
      tenantId: PLATFORM,
    });
    expect(found).toEqual({ status: 200, body: { id, status: "trial" } });

    const none = await app.licensing.findMerchantSubscription({
      tenantRef: "shop-b",
      tenantId: PLATFORM,
    });
    expect(none.status).toBe(404);

    const asMerchant = await app.licensing.findMerchantSubscription({
      tenantRef: "shop-a",
      tenantId: "shop-a",
    });
    expect(asMerchant.status).toBe(403);
  });
});
