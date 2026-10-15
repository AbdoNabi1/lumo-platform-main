import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import {
  calculateDiscounts,
  type CouponState,
  type DiscountCandidate,
  type DiscountLine,
} from "./discount-calculator";
import { Promotion } from "./promotion";
import {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  type CombinesWith,
  type DiscountMethod,
} from "./value-objects/discount-settings";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
  type PromotionRewardProps,
  type PromotionRuleType,
  type PromotionScope,
} from "./value-objects/promotion-rule";
import {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "./value-objects/promotion-schedule";

const NOW = new Date("2026-10-16T12:00:00.000Z");

interface PromoOptions {
  readonly id: string;
  readonly ruleType?: PromotionRuleType;
  readonly scope?: PromotionScope;
  readonly targetRefs?: string[];
  readonly minimumQuantity?: number;
  readonly minimumSubtotalAmountMinor?: number;
  readonly reward: PromotionRewardProps;
  readonly method?: DiscountMethod;
  readonly combinesWith?: CombinesWith;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  readonly customerRefs?: string[];
  readonly usageLimit?: number;
  readonly active?: boolean;
}

function promo(o: PromoOptions): Promotion {
  const reward = PromotionReward.create(o.reward);
  if (!reward.ok) throw new Error(reward.error.message);
  const rule = PromotionRule.create(
    o.ruleType ?? "automatic",
    PromotionCondition.create({
      scope: o.scope ?? "cart",
      targetRefs: o.targetRefs ?? [],
      minimumQuantity: o.minimumQuantity,
      minimumSubtotalAmountMinor: o.minimumSubtotalAmountMinor,
    }),
    reward.value,
    false,
    0,
  );
  if (!rule.ok) throw new Error(rule.error.message);
  const p = Promotion.create(
    UniqueEntityId.from(o.id),
    o.id,
    rule.value,
    PromotionSchedule.create(o.startsAt ?? new Date(0), o.endsAt),
    o.customerRefs === undefined
      ? CustomerEligibility.everyone()
      : CustomerEligibility.create({ customerRefs: o.customerRefs }),
    PromotionCampaign.none(),
    o.usageLimit,
    { method: o.method ?? "automatic", combinesWith: o.combinesWith ?? COMBINES_WITH_NOTHING },
  );
  if (o.active !== false) p.activate("evt", new Date(0));
  return p;
}

function coupon(code: string, overrides: Partial<CouponState> = {}): CouponState {
  return {
    couponId: `coupon-${code}`,
    code,
    status: "active",
    usageCount: 0,
    oncePerCustomer: false,
    redemptions: [],
    ...overrides,
  };
}

function line(
  lineRef: string,
  productRef: string,
  unitPriceMinor: number,
  quantity = 1,
  categoryRefs: string[] = [],
): DiscountLine {
  return { lineRef, productRef, categoryRefs, quantity, unitPriceMinor };
}

function run(
  candidates: DiscountCandidate[],
  lines: DiscountLine[],
  options: {
    codes?: string[];
    shipping?: { countryCode: string; rateMinor: number } | null;
    customer?: { customerRef?: string; email?: string };
  } = {},
) {
  return calculateDiscounts({
    lines,
    shipping: options.shipping ?? null,
    customer: options.customer ?? {},
    enteredCodes: options.codes ?? [],
    candidates,
    now: NOW,
  });
}

describe("calculateDiscounts — amount off order", () => {
  it("takes a percentage off the whole order and allocates it over the lines", () => {
    const sale = promo({ id: "p1", method: "code", reward: { type: "percentage", value: 10 } });
    const result = run(
      [{ promotion: sale, coupon: coupon("SALE10") }],
      [line("0", "a", 1_000), line("1", "b", 3_000)],
      {
        codes: ["SALE10"],
      },
    );
    expect(result.orderDiscountMinor).toBe(400);
    expect(result.codeStatuses).toEqual([{ code: "SALE10", applicable: true }]);
    expect(result.lineAllocations).toEqual([
      { lineRef: "0", amountMinor: 100 },
      { lineRef: "1", amountMinor: 300 },
    ]);
  });

  it("never takes more than the order is worth (Review Focus 3)", () => {
    const big = promo({ id: "p1", reward: { type: "fixed_amount", value: 50_000 } });
    const result = run([{ promotion: big }], [line("0", "a", 1_000)]);
    expect(result.orderDiscountMinor).toBe(1_000);
  });

  it("refuses a code below the minimum purchase", () => {
    const sale = promo({
      id: "p1",
      method: "code",
      minimumSubtotalAmountMinor: 20_000,
      reward: { type: "percentage", value: 10 },
    });
    const result = run([{ promotion: sale, coupon: coupon("SALE10") }], [line("0", "a", 1_000)], {
      codes: ["SALE10"],
    });
    expect(result.orderDiscountMinor).toBe(0);
    expect(result.codeStatuses).toEqual([
      { code: "SALE10", applicable: false, reason: "minimum_not_met" },
    ]);
  });
});

describe("calculateDiscounts — amount off products", () => {
  it("takes the percentage off the matching lines only", () => {
    const shoes = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "percentage", value: 25 },
    });
    const result = run([{ promotion: shoes }], [line("0", "shoe", 2_000), line("1", "hat", 5_000)]);
    expect(result.orderDiscountMinor).toBe(500);
    expect(result.lineAllocations).toEqual([{ lineRef: "0", amountMinor: 500 }]);
  });

  it("matches by category", () => {
    const summer = promo({
      id: "p1",
      scope: "category",
      targetRefs: ["summer"],
      reward: { type: "percentage", value: 50 },
    });
    const result = run(
      [{ promotion: summer }],
      [line("0", "tee", 1_000, 1, ["summer"]), line("1", "coat", 9_000, 1, ["winter"])],
    );
    expect(result.orderDiscountMinor).toBe(500);
  });

  it("takes a fixed amount off each matching item, never below zero", () => {
    const off = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "fixed_amount", value: 1_500 },
    });
    const result = run([{ promotion: off }], [line("0", "shoe", 1_000, 3)]);
    expect(result.orderDiscountMinor).toBe(3_000);
  });

  it("takes a fixed amount once per order when asked to", () => {
    const off = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "fixed_amount", value: 1_500, appliesOncePerOrder: true },
    });
    const result = run([{ promotion: off }], [line("0", "shoe", 1_000, 3)]);
    expect(result.orderDiscountMinor).toBe(1_500);
  });

  it("rejects a code whose products are not in the cart", () => {
    const shoes = promo({
      id: "p1",
      method: "code",
      scope: "product",
      targetRefs: ["shoe"],
      reward: { type: "percentage", value: 10 },
    });
    const result = run([{ promotion: shoes, coupon: coupon("SHOES") }], [line("0", "hat", 1_000)], {
      codes: ["SHOES"],
    });
    expect(result.codeStatuses[0]).toEqual({
      code: "SHOES",
      applicable: false,
      reason: "no_matching_items",
    });
  });

  it("measures the minimum purchase on the matching items only, as Shopify", () => {
    const shoes = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["shoe"],
      minimumSubtotalAmountMinor: 5_000,
      reward: { type: "percentage", value: 10 },
    });
    const result = run([{ promotion: shoes }], [line("0", "shoe", 1_000), line("1", "hat", 9_000)]);
    expect(result.orderDiscountMinor).toBe(0);
  });
});

describe("calculateDiscounts — buy X get Y", () => {
  const bxgy = (overrides: Partial<PromotionRewardProps> = {}) =>
    promo({
      id: "p1",
      ruleType: "buy_x_get_y",
      scope: "product",
      targetRefs: ["shirt"],
      reward: {
        type: "buy_x_get_y",
        buys: { kind: "quantity", value: 2 },
        gets: { quantity: 1, scope: "product", targetRefs: ["sock"], effect: { kind: "free" } },
        ...overrides,
      },
    });

  it("gives the cheapest qualifying item free once the customer buys enough", () => {
    const result = run(
      [{ promotion: bxgy() }],
      [line("0", "shirt", 3_000, 2), line("1", "sock", 500, 1)],
    );
    expect(result.orderDiscountMinor).toBe(500);
  });

  it("gives nothing when the customer has not bought enough", () => {
    const result = run(
      [{ promotion: bxgy() }],
      [line("0", "shirt", 3_000, 1), line("1", "sock", 500, 1)],
    );
    expect(result.orderDiscountMinor).toBe(0);
  });

  it("never counts the same unit as both bought and got", () => {
    const sameItem = promo({
      id: "p1",
      ruleType: "buy_x_get_y",
      scope: "product",
      targetRefs: ["shirt"],
      reward: {
        type: "buy_x_get_y",
        buys: { kind: "quantity", value: 2 },
        gets: { quantity: 1, scope: "product", targetRefs: ["shirt"], effect: { kind: "free" } },
      },
    });
    expect(run([{ promotion: sameItem }], [line("0", "shirt", 1_000, 2)]).orderDiscountMinor).toBe(
      0,
    );
    expect(run([{ promotion: sameItem }], [line("0", "shirt", 1_000, 3)]).orderDiscountMinor).toBe(
      1_000,
    );
  });

  it("respects the maximum uses per order", () => {
    const result = run(
      [{ promotion: bxgy({ maxUsesPerOrder: 1 }) }],
      [line("0", "shirt", 3_000, 4), line("1", "sock", 500, 2)],
    );
    expect(result.orderDiscountMinor).toBe(500);
  });

  it("applies a percentage effect", () => {
    const half = bxgy({
      gets: {
        quantity: 1,
        scope: "product",
        targetRefs: ["sock"],
        effect: { kind: "percentage", value: 50 },
      },
    });
    const result = run(
      [{ promotion: half }],
      [line("0", "shirt", 3_000, 2), line("1", "sock", 500, 1)],
    );
    expect(result.orderDiscountMinor).toBe(250);
  });
});

describe("calculateDiscounts — free shipping", () => {
  const free = (overrides: Partial<PromotionRewardProps> = {}) =>
    promo({ id: "p1", method: "code", reward: { type: "free_shipping", ...overrides } });

  it("makes the selected rate free", () => {
    const result = run(
      [{ promotion: free(), coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      {
        codes: ["SHIPFREE"],
        shipping: { countryCode: "EG", rateMinor: 6_000 },
      },
    );
    expect(result.shippingDiscountMinor).toBe(6_000);
    expect(result.orderDiscountMinor).toBe(0);
  });

  it("is accepted with nothing off before shipping is chosen (Review Focus 5)", () => {
    const result = run(
      [{ promotion: free(), coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      { codes: ["SHIPFREE"] },
    );
    expect(result.codeStatuses).toEqual([{ code: "SHIPFREE", applicable: true }]);
    expect(result.shippingDiscountMinor).toBe(0);
  });

  it("refuses another country and a rate above the cap", () => {
    const limited = free({ countries: ["EG"], maxShippingRateMinor: 5_000 });
    const elsewhere = run(
      [{ promotion: limited, coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      {
        codes: ["SHIPFREE"],
        shipping: { countryCode: "SA", rateMinor: 1_000 },
      },
    );
    expect(elsewhere.codeStatuses[0]?.reason).toBe("not_eligible");
    const expensive = run(
      [{ promotion: limited, coupon: coupon("SHIPFREE") }],
      [line("0", "a", 1_000)],
      {
        codes: ["SHIPFREE"],
        shipping: { countryCode: "EG", rateMinor: 9_000 },
      },
    );
    expect(expensive.codeStatuses[0]?.reason).toBe("not_eligible");
  });
});

describe("calculateDiscounts — eligibility", () => {
  const sale = (o: Partial<PromoOptions> = {}) =>
    promo({ id: "p1", method: "code", reward: { type: "percentage", value: 10 }, ...o });
  const cart = [line("0", "a", 10_000)];
  const reasonFor = (candidate: DiscountCandidate, customer = {}) =>
    run([candidate], cart, { codes: ["SALE10"], customer }).codeStatuses[0]?.reason;

  it("answers not_found for an unknown code", () => {
    expect(run([], cart, { codes: ["NOPE"] }).codeStatuses).toEqual([
      { code: "NOPE", applicable: false, reason: "not_found" },
    ]);
  });

  it("normalises the code the customer typed (Review Focus 1)", () => {
    expect(
      run([{ promotion: sale(), coupon: coupon("SALE10") }], cart, { codes: [" sale10 "] })
        .codeStatuses,
    ).toEqual([{ code: "SALE10", applicable: true }]);
  });

  it("answers not_started and expired from the dates", () => {
    expect(
      reasonFor({
        promotion: sale({ startsAt: new Date("2027-01-01") }),
        coupon: coupon("SALE10"),
      }),
    ).toBe("not_started");
    expect(
      reasonFor({ promotion: sale({ endsAt: new Date("2026-01-01") }), coupon: coupon("SALE10") }),
    ).toBe("expired");
  });

  it("answers not_found for a deactivated or deleted code", () => {
    expect(reasonFor({ promotion: sale(), coupon: coupon("SALE10", { status: "disabled" }) })).toBe(
      "not_found",
    );
    expect(reasonFor({ promotion: sale({ active: false }), coupon: coupon("SALE10") })).toBe(
      "not_found",
    );
  });

  it("answers not_eligible for a customer outside the list", () => {
    const only = { promotion: sale({ customerRefs: ["vip"] }), coupon: coupon("SALE10") };
    expect(reasonFor(only, { customerRef: "someone" })).toBe("not_eligible");
    expect(reasonFor(only, {})).toBe("not_eligible");
    expect(reasonFor(only, { customerRef: "vip" })).toBeUndefined();
  });

  it("answers usage_limit_reached when the code is used up", () => {
    expect(
      reasonFor({ promotion: sale(), coupon: coupon("SALE10", { usageLimit: 2, usageCount: 2 }) }),
    ).toBe("usage_limit_reached");
  });

  it("answers already_used for the same customer or the same guest email in any case (Review Focus 4)", () => {
    const once = coupon("SALE10", {
      oncePerCustomer: true,
      redemptions: [{ customerRef: "c-1", email: "Ali@Example.com" }],
    });
    expect(reasonFor({ promotion: sale(), coupon: once }, { customerRef: "c-1" })).toBe(
      "already_used",
    );
    expect(reasonFor({ promotion: sale(), coupon: once }, { email: "ali@example.COM" })).toBe(
      "already_used",
    );
    expect(
      reasonFor(
        { promotion: sale(), coupon: once },
        { customerRef: "c-2", email: "other@example.com" },
      ),
    ).toBeUndefined();
  });

  it("answers too_many_codes beyond five", () => {
    const codes = ["A1A", "B1B", "C1C", "D1D", "E1E", "F1F"];
    const result = run([], cart, { codes });
    expect(result.codeStatuses[5]).toEqual({
      code: "F1F",
      applicable: false,
      reason: "too_many_codes",
    });
  });

  it("never applies a code-only discount without its code", () => {
    const codeOnly = { promotion: sale(), coupon: coupon("SALE10") };
    expect(run([codeOnly], cart).orderDiscountMinor).toBe(0);
  });
});

describe("calculateDiscounts — combinations", () => {
  it("keeps the larger saving when two discounts cannot combine, and says why", () => {
    const auto = promo({ id: "p1", reward: { type: "percentage", value: 5 } });
    const code = promo({ id: "p2", method: "code", reward: { type: "percentage", value: 20 } });
    const result = run(
      [{ promotion: auto }, { promotion: code, coupon: coupon("BIG20") }],
      [line("0", "a", 10_000)],
      {
        codes: ["BIG20"],
      },
    );
    expect(result.orderDiscountMinor).toBe(2_000);
    expect(result.applied.map((a) => a.promotionId)).toEqual(["p2"]);
  });

  it("answers cannot_combine for an entered code left out", () => {
    const auto = promo({ id: "p1", reward: { type: "percentage", value: 30 } });
    const code = promo({ id: "p2", method: "code", reward: { type: "percentage", value: 10 } });
    const result = run(
      [{ promotion: auto }, { promotion: code, coupon: coupon("SMALL10") }],
      [line("0", "a", 10_000)],
      {
        codes: ["SMALL10"],
      },
    );
    expect(result.codeStatuses).toEqual([
      { code: "SMALL10", applicable: false, reason: "cannot_combine" },
    ]);
    expect(result.orderDiscountMinor).toBe(3_000);
  });

  it("applies product discounts before order discounts when both allow it", () => {
    const product = promo({
      id: "p1",
      scope: "product",
      targetRefs: ["a"],
      reward: { type: "fixed_amount", value: 2_000 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const order = promo({
      id: "p2",
      reward: { type: "percentage", value: 10 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const result = run([{ promotion: product }, { promotion: order }], [line("0", "a", 10_000)]);
    // 10,000 − 2,000 = 8,000, then 10% of 8,000 = 800.
    expect(result.orderDiscountMinor).toBe(2_800);
  });

  it("combines free shipping with an order discount when both allow it", () => {
    const order = promo({
      id: "p1",
      reward: { type: "percentage", value: 10 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const ship = promo({
      id: "p2",
      method: "code",
      reward: { type: "free_shipping" },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const result = run(
      [{ promotion: order }, { promotion: ship, coupon: coupon("SHIP") }],
      [line("0", "a", 10_000)],
      {
        codes: ["SHIP"],
        shipping: { countryCode: "EG", rateMinor: 5_000 },
      },
    );
    expect(result.orderDiscountMinor).toBe(1_000);
    expect(result.shippingDiscountMinor).toBe(5_000);
  });
});

describe("calculateDiscounts — codes that give nothing (Review Finding 1)", () => {
  const sameItemCode = promo({
    id: "p1",
    method: "code",
    ruleType: "buy_x_get_y",
    scope: "product",
    targetRefs: ["shirt"],
    reward: {
      type: "buy_x_get_y",
      buys: { kind: "quantity", value: 2 },
      gets: { quantity: 1, scope: "product", targetRefs: ["shirt"], effect: { kind: "free" } },
    },
  });
  const candidates = [{ promotion: sameItemCode, coupon: coupon("BUY2GET1") }];

  it("reports a buy 2 get 1 code as no_matching_items when no free unit is left", () => {
    const result = run(candidates, [line("0", "shirt", 1_000, 2)], { codes: ["BUY2GET1"] });
    expect(result.codeStatuses).toEqual([
      { code: "BUY2GET1", applicable: false, reason: "no_matching_items" },
    ]);
    expect(result.orderDiscountMinor).toBe(0);
    expect(result.applied).toEqual([]);
  });

  it("accepts the same code once a third shirt makes the free unit available", () => {
    const result = run(candidates, [line("0", "shirt", 1_000, 3)], { codes: ["BUY2GET1"] });
    expect(result.codeStatuses).toEqual([{ code: "BUY2GET1", applicable: true }]);
    expect(result.orderDiscountMinor).toBe(1_000);
  });

  it("reports a code that stacks onto a discount which already took everything as no_matching_items", () => {
    const all = promo({
      id: "p1",
      method: "code",
      reward: { type: "percentage", value: 100 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const ten = promo({
      id: "p2",
      method: "code",
      reward: { type: "percentage", value: 10 },
      combinesWith: COMBINES_WITH_EVERYTHING,
    });
    const result = run(
      [
        { promotion: all, coupon: coupon("ALL") },
        { promotion: ten, coupon: coupon("TEN") },
      ],
      [line("0", "a", 10_000)],
      { codes: ["ALL", "TEN"] },
    );
    expect(result.codeStatuses).toEqual([
      { code: "ALL", applicable: true },
      { code: "TEN", applicable: false, reason: "no_matching_items" },
    ]);
    expect(result.applied.map((a) => a.code)).toEqual(["ALL"]);
    expect(result.orderDiscountMinor).toBe(10_000);
  });
});

describe("calculateDiscounts — buy X get Y by amount (Review Finding 2)", () => {
  const amountBxgy = (buysValue: number) =>
    promo({
      id: "p1",
      ruleType: "buy_x_get_y",
      scope: "product",
      targetRefs: ["shirt"],
      reward: {
        type: "buy_x_get_y",
        buys: { kind: "amount", value: buysValue },
        gets: { quantity: 1, scope: "product", targetRefs: ["shirt"], effect: { kind: "free" } },
      },
    });
  // Two shirts on separate lines, 3,000 and 1,000. The cheaper one is the free unit.
  const cart = [line("0", "shirt", 3_000), line("1", "shirt", 1_000)];

  it("gives the free unit when the other units alone reach the amount", () => {
    expect(run([{ promotion: amountBxgy(3_000) }], cart).orderDiscountMinor).toBe(1_000);
  });

  it("gives nothing when only the free unit makes up the amount", () => {
    expect(run([{ promotion: amountBxgy(3_500) }], cart).orderDiscountMinor).toBe(0);
  });
});

describe("calculateDiscounts — greedy selection above ten eligible discounts (Review Finding 2)", () => {
  it("applies every discount when all of eleven can combine", () => {
    const discounts = Array.from({ length: 11 }, (_, i) =>
      promo({
        id: `p${i}`,
        scope: "product",
        targetRefs: [`item${i}`],
        reward: { type: "fixed_amount", value: 100 },
        combinesWith: COMBINES_WITH_EVERYTHING,
      }),
    );
    const lines = Array.from({ length: 11 }, (_, i) => line(`${i}`, `item${i}`, 1_000));
    const result = run(
      discounts.map((promotion) => ({ promotion })),
      lines,
    );
    expect(result.applied).toHaveLength(11);
    expect(result.orderDiscountMinor).toBe(1_100);
  });

  it("keeps only the largest of eleven discounts that cannot combine", () => {
    const discounts = Array.from({ length: 11 }, (_, i) =>
      promo({ id: `p${i}`, reward: { type: "percentage", value: i + 1 } }),
    );
    const result = run(
      discounts.map((promotion) => ({ promotion })),
      [line("0", "a", 10_000)],
    );
    expect(result.applied.map((a) => a.promotionId)).toEqual(["p10"]);
    expect(result.orderDiscountMinor).toBe(1_100);
  });
});

describe("calculateDiscounts — remaining eligibility and status rules (Review Finding 2)", () => {
  const sale = (o: Partial<PromoOptions> = {}) =>
    promo({ id: "p1", method: "code", reward: { type: "percentage", value: 10 }, ...o });
  const cart = [line("0", "a", 10_000)];
  const reasonFor = (candidate: DiscountCandidate, customer = {}) =>
    run([candidate], cart, { codes: ["SALE10"], customer }).codeStatuses[0]?.reason;

  it("answers expired for a coupon whose own end date has passed", () => {
    expect(
      reasonFor({
        promotion: sale(),
        coupon: coupon("SALE10", { expiresAt: new Date("2026-01-01") }),
      }),
    ).toBe("expired");
  });

  it("answers expired for an expired coupon and usage_limit_reached for a depleted one", () => {
    expect(reasonFor({ promotion: sale(), coupon: coupon("SALE10", { status: "expired" }) })).toBe(
      "expired",
    );
    expect(reasonFor({ promotion: sale(), coupon: coupon("SALE10", { status: "depleted" }) })).toBe(
      "usage_limit_reached",
    );
  });

  it("answers not_eligible for a coupon assigned to another customer", () => {
    const assigned = {
      promotion: sale(),
      coupon: coupon("SALE10", { assignedCustomerRef: "vip" }),
    };
    expect(reasonFor(assigned, { customerRef: "someone" })).toBe("not_eligible");
    expect(reasonFor(assigned, { customerRef: "vip" })).toBeUndefined();
  });

  it("answers minimum_not_met when the cart has too few items", () => {
    expect(reasonFor({ promotion: sale({ minimumQuantity: 3 }), coupon: coupon("SALE10") })).toBe(
      "minimum_not_met",
    );
  });

  it("answers usage_limit_reached once the promotion's own limit is used up", () => {
    const limited = sale({ usageLimit: 1 });
    limited.recordUsage("evt", new Date(0));
    expect(reasonFor({ promotion: limited, coupon: coupon("SALE10") })).toBe("usage_limit_reached");
  });

  it("answers expired for a paused promotion", () => {
    const paused = sale();
    paused.pause("evt", new Date(0));
    expect(reasonFor({ promotion: paused, coupon: coupon("SALE10") })).toBe("expired");
  });
});

describe("calculateDiscounts — allocation and entered codes (Review Finding 2)", () => {
  it("splits a percentage with a leftover unit so the allocations sum to the discount", () => {
    const sale = promo({ id: "p1", reward: { type: "percentage", value: 10 } });
    const result = run(
      [{ promotion: sale }],
      [line("0", "a", 333), line("1", "b", 333), line("2", "c", 334)],
    );
    expect(result.orderDiscountMinor).toBe(100);
    expect(result.lineAllocations).toEqual([
      { lineRef: "0", amountMinor: 33 },
      { lineRef: "1", amountMinor: 33 },
      { lineRef: "2", amountMinor: 34 },
    ]);
    expect(result.lineAllocations.reduce((sum, a) => sum + a.amountMinor, 0)).toBe(
      result.orderDiscountMinor,
    );
  });

  it("treats the same code typed twice as one code", () => {
    const sale = promo({ id: "p1", method: "code", reward: { type: "percentage", value: 10 } });
    const result = run([{ promotion: sale, coupon: coupon("SALE10") }], [line("0", "a", 10_000)], {
      codes: ["SALE10", "sale10"],
    });
    expect(result.codeStatuses).toEqual([{ code: "SALE10", applicable: true }]);
    expect(result.orderDiscountMinor).toBe(1_000);
  });

  it("ignores a code that is only whitespace", () => {
    expect(run([], [line("0", "a", 10_000)], { codes: ["  "] }).codeStatuses).toEqual([]);
  });
});
