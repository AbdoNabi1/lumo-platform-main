import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { Promotion, type PromotionSettings } from "../domain/promotion";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
  type PromotionRewardProps,
  type PromotionRuleType,
} from "../domain/value-objects/promotion-rule";
import {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "../domain/value-objects/promotion-schedule";
import { PromotionMapper, promotionRowFromRecord } from "./promotion.mapper";

const TENANT = "tenant-1";
const ID = "11111111-1111-4111-8111-111111111111";

function build(options: {
  ruleType?: PromotionRuleType;
  scope?: "cart" | "product" | "category";
  targetRefs?: readonly string[];
  minimumSubtotalAmountMinor?: number;
  reward: PromotionRewardProps;
  stackable?: boolean;
  customerRefs?: readonly string[];
  settings?: PromotionSettings;
}): Promotion {
  const reward = PromotionReward.create(options.reward);
  if (!reward.ok) throw new Error(`test setup: ${reward.error.message}`);
  const rule = PromotionRule.create(
    options.ruleType ?? "automatic",
    PromotionCondition.create({
      scope: options.scope ?? "cart",
      targetRefs: options.targetRefs ?? [],
      minimumSubtotalAmountMinor: options.minimumSubtotalAmountMinor,
    }),
    reward.value,
    options.stackable ?? false,
    0,
  );
  if (!rule.ok) throw new Error(`test setup: ${rule.error.message}`);
  return Promotion.create(
    UniqueEntityId.from(ID),
    "Autumn",
    rule.value,
    PromotionSchedule.create(new Date("2026-01-01T00:00:00.000Z")),
    options.customerRefs === undefined
      ? CustomerEligibility.everyone()
      : CustomerEligibility.create({ customerRefs: options.customerRefs }),
    PromotionCampaign.create(undefined),
    undefined,
    options.settings,
  );
}

/** Save then load, the way the Prisma repository does: toRow, the database's JSON columns, then back. */
function roundTrip(promotion: Promotion): Promotion {
  const stored = structuredClone(PromotionMapper.toRow(promotion, TENANT));
  return PromotionMapper.toDomain(promotionRowFromRecord(stored));
}

describe("PromotionMapper round trip", () => {
  it("keeps an amount-off-order code discount's minimum purchase, customers, method and combinations", () => {
    const original = build({
      reward: { type: "fixed_amount", value: 5_000 },
      minimumSubtotalAmountMinor: 20_000,
      customerRefs: ["c-1", "c-2"],
      settings: { method: "code", combinesWith: { product: true, order: false, shipping: true } },
    });

    const loaded = roundTrip(original);

    expect(loaded.rule.condition.minimumSubtotalAmountMinor).toBe(20_000);
    expect(loaded.eligibility.customerRefs).toEqual(["c-1", "c-2"]);
    expect(loaded.method).toBe("code");
    expect(loaded.combinesWith).toEqual({ product: true, order: false, shipping: true });
    expect(loaded.rule.reward.value).toBe(5_000);
    expect(PromotionMapper.toRow(loaded, TENANT)).toEqual(PromotionMapper.toRow(original, TENANT));
  });

  it("keeps a buy X get Y reward's buys, gets and uses per order", () => {
    const reward: PromotionRewardProps = {
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2 },
      gets: {
        quantity: 1,
        scope: "product",
        targetRefs: ["p-1"],
        effect: { kind: "percentage", value: 50 },
      },
      maxUsesPerOrder: 3,
    };
    const original = build({
      ruleType: "buy_x_get_y",
      scope: "product",
      targetRefs: ["p-1"],
      reward,
      settings: { method: "automatic" },
    });

    const loaded = roundTrip(original);

    expect(loaded.rule.reward.toProps()).toEqual(original.rule.reward.toProps());
    expect(loaded.rule.reward.buys).toEqual(reward.buys);
    expect(loaded.rule.reward.gets).toEqual(reward.gets);
    expect(loaded.rule.reward.maxUsesPerOrder).toBe(3);
    expect(PromotionMapper.toRow(loaded, TENANT)).toEqual(PromotionMapper.toRow(original, TENANT));
  });

  it("keeps a free shipping reward's countries and shipping rate cap", () => {
    const original = build({
      reward: { type: "free_shipping", countries: ["EG", "SA"], maxShippingRateMinor: 15_000 },
      settings: { method: "code" },
    });

    const loaded = roundTrip(original);

    expect(loaded.rule.reward.countries).toEqual(["EG", "SA"]);
    expect(loaded.rule.reward.maxShippingRateMinor).toBe(15_000);
    expect(loaded.discountClass).toBe("shipping");
    expect(PromotionMapper.toRow(loaded, TENANT)).toEqual(PromotionMapper.toRow(original, TENANT));
  });

  it("reads a row from before Phase 2 as code-only and combining with everything when stackable", () => {
    const original = build({ reward: { type: "percentage", value: 10 }, stackable: true });
    const stored = structuredClone(PromotionMapper.toRow(original, TENANT));

    const loaded = PromotionMapper.toDomain(
      promotionRowFromRecord({ ...stored, method: null, combinesWith: null }),
    );

    expect(loaded.method).toBeUndefined();
    expect(loaded.combinesWith).toEqual({ product: true, order: true, shipping: true });
  });

  it("reads a pre-Phase 2 row that is not stackable as combining with nothing", () => {
    const original = build({ reward: { type: "percentage", value: 10 }, stackable: false });
    const stored = structuredClone(PromotionMapper.toRow(original, TENANT));

    const loaded = PromotionMapper.toDomain(
      promotionRowFromRecord({ ...stored, method: null, combinesWith: null }),
    );

    expect(loaded.combinesWith).toEqual({ product: false, order: false, shipping: false });
  });
});
