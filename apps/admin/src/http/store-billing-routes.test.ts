import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireLicensing } from "@platform/licensing";
import { wireAdmin } from "../composition";
import { storeBillingRoutes } from "./store-billing-routes";

/**
 * Merchant billing routes: every `/store/billing*` route addresses the caller's own subscription by
 * `context.tenantId` (the merchant's ref) and reads the platform-owned rows under the platform scope.
 * One store can never see, pay or change another store's billing.
 */

const PLATFORM = "tenant-platform";
const clock: Clock = { now: () => new Date("2026-10-16T00:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "x" };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const serializer = new InMemoryEventSerializer();
  const stored = {
    sealer: {
      backing: "real" as const,
      seal: (ref: string, token: string) => Promise.resolve(`sealed(${ref}):${token}`),
      open: (_ref: string, sealed: string) => Promise.resolve(sealed),
    },
    charger: {
      chargeStoredMethod: (r: { idempotencyKey: string }) =>
        Promise.resolve({ providerReference: `psp-${r.idempotencyKey}` }),
    },
    enrolment: {
      startCheckout: () =>
        Promise.resolve({ providerOrderId: "order-1", checkoutUrl: "https://pay.test/checkout/1" }),
    },
    cardTokenVerifier: { verify: () => null },
    transactionVerifier: { verify: () => null },
  };
  const licensing = wireLicensing({
    serializer,
    idGenerator,
    clock,
    platformTenantId: PLATFORM,
    storedMethodBilling: stored,
  });
  const admin = wireAdmin({
    serializer,
    idGenerator,
    clock,
    platformTenantId: PLATFORM,
    licensing,
  });
  return { admin, raw: licensing.licensing, routes: storeBillingRoutes(admin) };
}

type Raw = ReturnType<typeof wire>["raw"];

function route(all: readonly RouteDefinition[], method: string, path: string): RouteDefinition {
  const found = all.find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

type Res = { status: number; body: unknown };
function call(
  r: RouteDefinition,
  shopId: string,
  params: object = {},
  body?: unknown,
): Promise<Res> {
  return r.handle({
    body,
    params,
    query: {},
    context: { tenantId: shopId, principal: staff, requestId: "req-1" },
  } as never) as Promise<Res>;
}

/** Seeds a published plan and a subscription for `shop`, plus an issued invoice for it (platform scope). */
async function seed(raw: Raw, shop: string, planKey: string): Promise<{ invoiceId: string }> {
  const plan = await raw.createPlan({
    key: planKey,
    name: planKey.toUpperCase(),
    tier: "starter",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await raw.createPlanDraft({
    planId,
    spec: {
      limits: { maxProducts: 100 },
      featureEntitlements: ["basic_reports"],
      pricing: {
        basePriceMinor: 29900,
        currency: "EGP",
        billingCycle: "monthly",
        trialDays: 14,
        creditAllowances: {},
      },
    },
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  await raw.publishPlanVersion({ planId, planVersionId, tenantId: PLATFORM });
  const created = await raw.createSubscription({
    tenantRef: shop,
    planVersionRef: planVersionId,
    tenantId: PLATFORM,
  });
  const subscriptionId = (created.body as { id: string }).id;
  await raw.activateSubscription({ subscriptionId, tenantId: PLATFORM });
  const invoice = await raw.createInvoice({
    tenantRef: shop,
    subscriptionRef: subscriptionId,
    currency: "EGP",
    lineItems: [{ description: "First period", amountMinor: 29900 }],
    tenantId: PLATFORM,
  });
  const invoiceId = (invoice.body as { id: string }).id;
  await raw.issueInvoice({ invoiceId, tenantId: PLATFORM });
  return { invoiceId };
}

describe("merchant billing routes (/store/billing)", () => {
  it("registers the four routes at version 1 with the settings permissions", () => {
    const { routes } = wire();
    expect(
      routes.map((r) => [r.method, r.path, r.version, r.permission, r.idempotent ?? false]),
    ).toEqual([
      ["GET", "/store/billing", 1, "settings:read", false],
      ["GET", "/store/billing/plans", 1, "settings:read", false],
      ["POST", "/store/billing/plan", 1, "settings:update", true],
      ["POST", "/store/billing/invoices/:invoiceId/pay", 1, "settings:update", false],
    ]);
  });

  it("exposes the platform scope as a function (tenant-mode-guard does not walk functions)", () => {
    const { admin } = wire();
    expect(typeof admin.platformScope).toBe("function");
    expect(admin.platformScope("shop-a")).toBe(PLATFORM);
  });

  it("a store sees its own plan and invoices; another store sees none of them", async () => {
    const { raw, routes } = wire();
    const { invoiceId } = await seed(raw, "shop-a", "basic");

    const a = await call(route(routes, "GET", "/store/billing"), "shop-a");
    expect(a.status).toBe(200);
    const viewA = a.body as { plan: { key: string } | null; invoices: Array<{ id: string }> };
    expect(viewA.plan?.key).toBe("basic");
    expect(viewA.invoices.map((i) => i.id)).toEqual([invoiceId]);

    const b = await call(route(routes, "GET", "/store/billing"), "shop-b");
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ plan: null, invoices: [] });
  });

  it("lists the published plans", async () => {
    const { raw, routes } = wire();
    await seed(raw, "shop-a", "basic");
    const res = await call(route(routes, "GET", "/store/billing/plans"), "shop-b");
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ key: string }> }).items;
    expect(items.map((p) => p.key)).toEqual(["basic"]);
  });

  it("changing to an unknown plan key is a 404; a known key re-pins the caller's own subscription", async () => {
    const { raw, routes } = wire();
    await seed(raw, "shop-a", "basic");
    const change = route(routes, "POST", "/store/billing/plan");

    const unknown = await call(change, "shop-a", {}, { planKey: "nope" });
    expect(unknown.status).toBe(404);

    const known = await call(change, "shop-a", {}, { planKey: "basic" });
    expect(known.status).toBe(200);
    expect(known.body).toHaveProperty("id");

    const noSubscription = await call(change, "shop-b", {}, { planKey: "basic" });
    expect(noSubscription.status).toBe(404);
  });

  it("the plan change body is strict: a client-named tenantRef (or any extra key) is rejected", () => {
    const { routes } = wire();
    const body = route(routes, "POST", "/store/billing/plan").schema?.body;
    expect(body?.safeParse({ planKey: "basic" }).success).toBe(true);
    expect(body?.safeParse({ planKey: "basic", tenantRef: "shop-b" }).success).toBe(false);
    expect(body?.safeParse({ planKey: "" }).success).toBe(false);
    expect(body?.safeParse({ planKey: "x".repeat(65) }).success).toBe(false);
  });

  it("pays only the caller's own invoice: another store's invoice id is a 404", async () => {
    const { raw, routes } = wire();
    const { invoiceId } = await seed(raw, "shop-a", "basic");
    const pay = route(routes, "POST", "/store/billing/invoices/:invoiceId/pay");

    const foreign = await call(pay, "shop-b", { invoiceId });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: "NOT_FOUND" });
    const missing = await call(pay, "shop-a", { invoiceId: "no-such-invoice" });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "NOT_FOUND" });

    const own = await call(pay, "shop-a", { invoiceId });
    expect(own.status).toBe(200);
    expect(own.body).toEqual({ checkoutUrl: "https://pay.test/checkout/1" });
  });
});
