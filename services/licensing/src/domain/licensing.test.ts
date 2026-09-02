import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Credit } from "./credit";
import { EntitlementResolver } from "./entitlement-resolver";
import { Invoice } from "./invoice";
import { MerchantCapabilities } from "./merchant-capabilities";
import { MerchantFeatureOverride } from "./merchant-feature-override";
import { Plan } from "./plan";
import { Subscription } from "./subscription";
import { UsageCounter } from "./usage-counter";
import type { PlanSpec } from "./value-objects/plan-spec";

function spec(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    limits: { maxProducts: 100 },
    featureEntitlements: ["basic_reports"],
    pricing: { basePrice: 2900, billingCycle: "monthly", creditAllowances: {} },
    ...overrides,
  };
}

describe("Plan / PlanVersion", () => {
  it("creates a draft, schedules, publishes, and never mutates an already-published version", () => {
    const plan = Plan.create(
      UniqueEntityId.from("plan-1"),
      "growth",
      "Growth",
      "growth",
      "evt-1",
      new Date(0),
    );
    const draft = plan.createDraft(spec(), "evt-2", new Date(0));
    expect(draft.status).toBe("draft");
    plan.publish(draft.id.toString(), "evt-3", new Date(0));
    expect(draft.status).toBe("published");
    expect(plan.publishedVersionId).toBe(draft.id.toString());
    expect(() => draft.schedule(new Date(1))).toThrow();
  });

  it("clones a draft from an existing version without affecting the source", () => {
    const plan = Plan.create(
      UniqueEntityId.from("plan-2"),
      "pro",
      "Pro",
      "pro",
      "evt-1",
      new Date(0),
    );
    const v1 = plan.createDraft(spec(), "evt-2", new Date(0));
    plan.publish(v1.id.toString(), "evt-3", new Date(0));
    const v2 = plan.clone(v1.id.toString(), "evt-4", new Date(0));
    expect(v2.status).toBe("draft");
    expect(v1.status).toBe("published");
  });

  it("rolls back the published pointer to a prior published version", () => {
    const plan = Plan.create(
      UniqueEntityId.from("plan-3"),
      "starter",
      "Starter",
      "starter",
      "evt-1",
      new Date(0),
    );
    const v1 = plan.createDraft(spec(), "evt-2", new Date(0));
    plan.publish(v1.id.toString(), "evt-3", new Date(0));
    const v2 = plan.createDraft(
      spec({ pricing: { ...spec().pricing, basePrice: 3900 } }),
      "evt-4",
      new Date(0),
    );
    plan.publish(v2.id.toString(), "evt-5", new Date(0));
    expect(plan.publishedVersionId).toBe(v2.id.toString());
    plan.rollback(v1.id.toString(), "evt-6", new Date(0));
    expect(plan.publishedVersionId).toBe(v1.id.toString());
  });

  it("diffs two versions section-by-section", () => {
    const plan = Plan.create(
      UniqueEntityId.from("plan-4"),
      "custom",
      "Custom",
      "custom",
      "evt-1",
      new Date(0),
    );
    const v1 = plan.createDraft(spec(), "evt-2", new Date(0));
    const v2 = plan.createDraft(
      spec({ featureEntitlements: ["basic_reports", "ai_forecast"] }),
      "evt-3",
      new Date(0),
    );
    const diff = plan.compare(v1.id.toString(), v2.id.toString());
    expect(diff.features).toBe(true);
    expect(diff.pricing).toBe(false);
  });
});

describe("Subscription", () => {
  it("progresses trial -> active -> grace -> active, and pins/repins a plan version", () => {
    const subscription = Subscription.startTrial(
      UniqueEntityId.from("sub-1"),
      "tenant-1",
      "plan-1-v1",
      "evt-1",
      new Date(0),
    );
    expect(subscription.status).toBe("trial");
    subscription.activate("evt-2", new Date(0));
    subscription.enterGrace(7, "evt-3", new Date(0));
    expect(subscription.status).toBe("grace");
    expect(subscription.gracePeriodDays).toBe(7);
    subscription.activate("evt-4", new Date(0));
    subscription.repin("plan-1-v2", "evt-5", new Date(0));
    expect(subscription.planVersionRef).toBe("plan-1-v2");
  });

  it("pauses and resumes", () => {
    const subscription = Subscription.startTrial(
      UniqueEntityId.from("sub-2"),
      "tenant-2",
      "plan-1-v1",
      "evt-1",
      new Date(0),
    );
    subscription.activate("evt-2", new Date(0));
    const resumeDate = new Date("2026-08-01T00:00:00.000Z");
    subscription.pause(resumeDate, "evt-3", new Date(0));
    expect(subscription.pausedUntil).toEqual(resumeDate);
    subscription.resume("evt-4", new Date(0));
    expect(subscription.pausedUntil).toBeUndefined();
  });

  it("rejects an invalid transition (cancelled has no outgoing transitions)", () => {
    const subscription = Subscription.startTrial(
      UniqueEntityId.from("sub-3"),
      "tenant-3",
      "plan-1-v1",
      "evt-1",
      new Date(0),
    );
    subscription.cancel("no longer needed", "evt-2", new Date(0));
    expect(() => subscription.activate("evt-3", new Date(0))).toThrow();
  });
});

describe("MerchantFeatureOverride / MerchantCapabilities", () => {
  it("resolves the legacy override's effective state, honoring expiry", () => {
    const override = MerchantFeatureOverride.create(
      UniqueEntityId.from("mfo-1"),
      "tenant-1",
      "ai_forecast",
      "temp_grant",
      "evt-1",
      new Date(0),
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(override.effectiveState(new Date("2025-12-01T00:00:00.000Z"))).toBe("temp_grant");
    expect(override.effectiveState(new Date("2026-02-01T00:00:00.000Z"))).toBeUndefined();
  });

  it("grants and revokes a capability, keeping an append-only audit history", () => {
    const capabilities = MerchantCapabilities.create(
      UniqueEntityId.from("cap-1"),
      "tenant-1",
      "evt-1",
      new Date(0),
    );
    capabilities.grant("ai_forecast", true, "beta", "evt-2", new Date(0));
    expect(capabilities.resolve("ai_forecast", new Date(0))?.enabled).toBe(true);
    capabilities.revoke("ai_forecast", "evt-3", new Date(0));
    expect(capabilities.resolve("ai_forecast", new Date(0))).toBeUndefined();
    expect(capabilities.auditHistory).toHaveLength(2);
  });
});

describe("UsageCounter / Credit / Invoice", () => {
  it("increments usage from recorded events", () => {
    const counter = UsageCounter.create(
      UniqueEntityId.from("uc-1"),
      "tenant-1",
      "AI_TOKEN",
      "evt-1",
      new Date(0),
    );
    counter.recordUsage(100, "tokens", new Date(0), "evt-2");
    counter.recordUsage(50, "tokens", new Date(1), "evt-3");
    expect(counter.amount).toBe(150);
  });

  it("grants and consumes a credit", () => {
    const credit = Credit.grant(
      UniqueEntityId.from("cr-1"),
      "tenant-1",
      500,
      "goodwill",
      "evt-1",
      new Date(0),
    );
    credit.consume(200, "evt-2", new Date(0));
    expect(credit.amount).toBe(300);
    expect(credit.status).toBe("granted");
    credit.consume(300, "evt-3", new Date(0));
    expect(credit.status).toBe("consumed");
  });

  it("issues and pays an invoice", () => {
    const invoice = Invoice.createDraft(
      UniqueEntityId.from("inv-1"),
      "tenant-1",
      "sub-1",
      "USD",
      [{ description: "Growth plan", amount: 2900 }],
      "evt-1",
      new Date(0),
    );
    expect(invoice.total).toBe(2900);
    invoice.issue("evt-2", new Date(0));
    invoice.markPaid("psp-ref-1", "evt-3", new Date(0));
    expect(invoice.status).toBe("paid");
    expect(invoice.paymentReference).toBe("psp-ref-1");
  });
});

describe("EntitlementResolver", () => {
  it("honors the 5-tier order, platform emergency override winning first", () => {
    expect(
      EntitlementResolver.resolve({
        planEntitlement: true,
        developerFlag: true,
        platformEmergencyOverride: "disabled",
      }),
    ).toBe("disabled");
  });

  it("falls through to plan entitlement when no overrides are set", () => {
    expect(EntitlementResolver.resolve({ planEntitlement: false, developerFlag: true })).toBe(
      "disabled",
    );
    expect(EntitlementResolver.resolve({ planEntitlement: true, developerFlag: true })).toBe(
      "enabled",
    );
  });

  it("gates on feature availability ahead of the developer flag", () => {
    expect(
      EntitlementResolver.resolve({
        planEntitlement: true,
        developerFlag: true,
        featureAvailability: false,
      }),
    ).toBe("disabled");
  });
});
