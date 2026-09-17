import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing } from "./composition";
import type { PlanSpec } from "./domain/value-objects/plan-spec";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireLicensing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

function spec(): PlanSpec {
  return {
    limits: { maxProducts: 100 },
    featureEntitlements: ["basic_reports"],
    pricing: { basePrice: 2900, billingCycle: "monthly", creditAllowances: {} },
  };
}

describe("licensing (end to end)", () => {
  it("creates a plan, publishes a version, and starts a subscription pinned to it", async () => {
    const app = wire();
    const plan = await app.licensing.createPlan({
      key: "growth",
      name: "Growth",
      tier: "growth",
      tenantId: "tenant-local",
    });
    expect(plan.status).toBe(201);
    const planId = (plan.body as { id: string }).id;

    const draft = await app.licensing.createPlanDraft({
      planId,
      spec: spec(),
      tenantId: "tenant-local",
    });
    expect(draft.status).toBe(201);
    const planVersionId = (draft.body as { planVersionId: string }).planVersionId;

    const published = await app.licensing.publishPlanVersion({
      planId,
      planVersionId,
      tenantId: "tenant-local",
    });
    expect(published.status).toBe(200);

    const subscription = await app.licensing.createSubscription({
      tenantRef: "tenant-1",
      planVersionRef: planVersionId,
      tenantId: "tenant-local",
    });
    expect(subscription.status).toBe(201);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("licensing.plan.version_published");
    expect(app.deliveredEventTypes).toContain("licensing.subscription.started");
  });

  it("grants a merchant capability and records usage idempotently", async () => {
    const app = wire();
    const grant = await app.licensing.grantMerchantCapability({
      tenantRef: "tenant-1",
      featureKey: "ai_forecast",
      enabled: true,
      source: "beta",
      tenantId: "tenant-local",
    });
    expect(grant.status).toBe(200);

    const first = await app.licensing.recordUsage({
      recordId: "usage-1",
      tenantRef: "tenant-1",
      resource: "AI_TOKEN",
      amount: 100,
      unit: "tokens",
      occurredAt: new Date(0),
      tenantId: "tenant-local",
    });
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);

    const duplicate = await app.licensing.recordUsage({
      recordId: "usage-1",
      tenantRef: "tenant-1",
      resource: "AI_TOKEN",
      amount: 100,
      unit: "tokens",
      occurredAt: new Date(0),
      tenantId: "tenant-local",
    });
    expect((duplicate.body as { duplicate: boolean }).duplicate).toBe(true);

    const counter = await app.licensing.getUsageCounter({
      tenantRef: "tenant-1",
      resource: "AI_TOKEN",
      tenantId: "tenant-local",
    });
    expect((counter.body as { amount: number }).amount).toBe(100);
  });

  it("creates, issues, and collects an invoice through the Payments/Finance stubs", async () => {
    const app = wire();
    const invoice = await app.licensing.createInvoice({
      tenantRef: "tenant-1",
      subscriptionRef: "sub-1",
      currency: "USD",
      lineItems: [{ description: "Growth plan", amount: 2900 }],
      tenantId: "tenant-local",
    });
    expect(invoice.status).toBe(201);
    const invoiceId = (invoice.body as { id: string }).id;

    await app.licensing.issueInvoice({ invoiceId, tenantId: "tenant-local" });
    const collected = await app.licensing.collectInvoice({ invoiceId, tenantId: "tenant-local" });
    expect(collected.status).toBe(200);
  });

  it("rejects creating a duplicate plan key (409)", async () => {
    const app = wire();
    await app.licensing.createPlan({
      key: "growth",
      name: "Growth",
      tier: "growth",
      tenantId: "tenant-local",
    });
    const response = await app.licensing.createPlan({
      key: "growth",
      name: "Growth 2",
      tier: "growth",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("rejects publishing an unknown plan version (404)", async () => {
    const app = wire();
    const plan = await app.licensing.createPlan({
      key: "pro",
      name: "Pro",
      tier: "pro",
      tenantId: "tenant-local",
    });
    const planId = (plan.body as { id: string }).id;
    const response = await app.licensing.publishPlanVersion({
      planId,
      planVersionId: "missing",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
