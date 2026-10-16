import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Promotion } from "./promotion";
import { COMBINES_WITH_EVERYTHING, COMBINES_WITH_NOTHING } from "./value-objects/discount-settings";
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

function amountOffProductsRule(targetRefs: string[]): PromotionRule {
  const condition = PromotionCondition.create({ scope: "product", targetRefs });
  const reward = PromotionReward.create({ type: "percentage", value: 10 });
  if (!reward.ok) throw new Error("invalid fixture");
  const result = PromotionRule.create("automatic", condition, reward.value, false, 0);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("Promotion — Shopify discount settings (Phase 2)", () => {
  it("defaults to no method and combines with nothing unless stackable", () => {
    const p = promotion();
    expect(p.method).toBeUndefined();
    expect(p.combinesWith).toEqual(COMBINES_WITH_NOTHING);
    expect(p.discountClass).toBe("order");
  });

  it("keeps the method and combination flags it was created with", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-2"),
      "SALE10",
      rule(),
      PromotionSchedule.create(new Date(0)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
      undefined,
      { method: "code", combinesWith: COMBINES_WITH_EVERYTHING },
    );
    expect(p.method).toBe("code");
    expect(p.combinesWith).toEqual(COMBINES_WITH_EVERYTHING);
  });

  it("classes a product-scoped amount off as a product discount", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-3"),
      "Shoes",
      amountOffProductsRule(["shoe"]),
      PromotionSchedule.create(new Date(0)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
    );
    expect(p.discountClass).toBe("product");
  });

  it("evaluates a product-scoped percentage on the matching lines only", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-4"),
      "Shoes",
      amountOffProductsRule(["shoe"]),
      PromotionSchedule.create(new Date(0)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
    );
    p.activate("evt-1", new Date(0));
    const determination = p.evaluate(
      {
        lines: [
          { productRef: "shoe", categoryRefs: [], quantity: 1, unitPriceAmountMinor: 1_000 },
          { productRef: "hat", categoryRefs: [], quantity: 1, unitPriceAmountMinor: 9_000 },
        ],
        subtotalAmountMinor: 10_000,
      },
      "customer-1",
      [],
      new Date(0),
    );
    expect(determination?.discountAmountMinor).toBe(100);
  });

  it("updates every editable field", () => {
    const p = promotion();
    p.activate("evt-1", new Date(0));
    p.update({
      name: "15% off",
      rule: rule({ stackable: true }),
      schedule: PromotionSchedule.create(new Date(10), new Date(20)),
      eligibility: CustomerEligibility.create({ customerRefs: ["c-1"] }),
      usageLimit: 3,
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    expect(p.name).toBe("15% off");
    expect(p.schedule.endsAt).toEqual(new Date(20));
    expect(p.eligibility.customerRefs).toEqual(["c-1"]);
    expect(p.usageLimit).toBe(3);
    expect(p.combinesWith).toEqual(COMBINES_WITH_EVERYTHING);
  });

  it("refuses to change a discount's type", () => {
    const p = promotion();
    expect(() =>
      p.update({
        name: "x",
        rule: amountOffProductsRule(["shoe"]),
        schedule: p.schedule,
        eligibility: p.eligibility,
        combinesWith: COMBINES_WITH_NOTHING,
      }),
    ).toThrow(BusinessRuleError);
  });

  it("reports how Shopify would show it at a given moment", () => {
    const p = Promotion.create(
      UniqueEntityId.from("promo-5"),
      "Later",
      rule(),
      PromotionSchedule.create(new Date(100), new Date(200)),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
    );
    expect(p.viewAt(new Date(150))).toBe("expired"); // still a draft: not running
    p.activate("evt-1", new Date(0));
    expect(p.viewAt(new Date(50))).toBe("scheduled");
    expect(p.viewAt(new Date(150))).toBe("active");
    expect(p.viewAt(new Date(250))).toBe("expired");
    p.pause("evt-2", new Date(150));
    expect(p.viewAt(new Date(150))).toBe("expired");
  });
});

describe("PromotionReward — Shopify reward shapes", () => {
  it("accepts a buy X get Y reward", () => {
    const reward = PromotionReward.create({
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2 },
      gets: { quantity: 1, scope: "product", targetRefs: ["sock"], effect: { kind: "free" } },
    });
    expect(reward.ok).toBe(true);
  });

  it("refuses a buy X get Y reward with no items to get", () => {
    const reward = PromotionReward.create({
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2 },
      gets: { quantity: 1, scope: "product", targetRefs: [], effect: { kind: "free" } },
    });
    expect(reward.ok).toBe(false);
  });

  it("refuses free-shipping countries that are not ISO codes", () => {
    const reward = PromotionReward.create({ type: "free_shipping", countries: ["Egypt"] });
    expect(reward.ok).toBe(false);
  });

  it("refuses a fractional fixed amount", () => {
    const reward = PromotionReward.create({ type: "fixed_amount", value: 10.5 });
    expect(reward.ok).toBe(false);
  });
});
