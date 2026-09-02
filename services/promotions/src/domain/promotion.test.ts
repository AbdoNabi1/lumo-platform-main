import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Promotion } from "./promotion";
import { PromotionCondition, PromotionReward, PromotionRule } from "./value-objects/promotion-rule";
import {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "./value-objects/promotion-schedule";

function rule(overrides: Partial<{ stackable: boolean; priority: number }> = {}): PromotionRule {
  const condition = PromotionCondition.create({ scope: "cart", targetRefs: [] });
  const reward = PromotionReward.create({ type: "percentage", value: 10 });
  if (!reward.ok) throw new Error("invalid fixture");
  const result = PromotionRule.create(
    "automatic",
    condition,
    reward.value,
    overrides.stackable ?? false,
    overrides.priority ?? 0,
  );
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function promotion(usageLimit?: number): Promotion {
  return Promotion.create(
    UniqueEntityId.from("promo-1"),
    "10% off",
    rule(),
    PromotionSchedule.create(new Date(0)),
    CustomerEligibility.everyone(),
    PromotionCampaign.none(),
    usageLimit,
  );
}

describe("Promotion", () => {
  it("starts at draft and raises an event on its first transition", () => {
    const p = promotion();
    expect(p.status.value).toBe("draft");
    p.activate("evt-1", new Date(0));
    expect(p.status.value).toBe("active");
    const events = p.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("promotion.transitioned");
  });

  it("evaluates a matching active cart with a percentage discount", () => {
    const p = promotion();
    p.activate("evt-1", new Date(0));
    const determination = p.evaluate(
      { lines: [], subtotalAmountMinor: 1_000 },
      "customer-1",
      [],
      new Date(0),
    );
    expect(determination?.discountAmountMinor).toBe(100);
  });

  it("does not evaluate a paused promotion", () => {
    const p = promotion();
    p.activate("evt-1", new Date(0));
    p.pause("evt-2", new Date(0));
    const determination = p.evaluate(
      { lines: [], subtotalAmountMinor: 1_000 },
      "customer-1",
      [],
      new Date(0),
    );
    expect(determination).toBeNull();
  });

  it("auto-transitions to depleted once the usage limit is reached", () => {
    const p = promotion(1);
    p.activate("evt-1", new Date(0));
    p.recordUsage("evt-2", new Date(0));
    expect(p.status.value).toBe("depleted");
  });

  it("rejects an illegal transition (e.g. draft -> paused directly, 409)", () => {
    const p = promotion();
    expect(() => p.transition("paused", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });
});
