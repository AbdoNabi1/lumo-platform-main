import type { Coupon } from "@platform/coupons";
import type { Promotion } from "@platform/promotions";
import type { DiscountInput } from "./discount-input";

export type DiscountType =
  "amount_off_products" | "amount_off_order" | "buy_x_get_y" | "free_shipping";
export interface DiscountDto {
  readonly id: string;
  readonly type: DiscountType;
  readonly method: "code" | "automatic";
  readonly title: string;
  readonly code: string | null;
  readonly status: "active" | "scheduled" | "expired";
  readonly value: { readonly kind: "percentage" | "fixed_amount"; readonly amount: number } | null;
  readonly appliesTo: {
    readonly kind: "products" | "categories";
    readonly refs: readonly string[];
  } | null;
  readonly appliesOncePerOrder: boolean;
  readonly buys: {
    readonly kind: "quantity" | "amount";
    readonly value: number;
    readonly scope: "products" | "categories";
    readonly refs: readonly string[];
  } | null;
  readonly gets: {
    readonly quantity: number;
    readonly scope: "products" | "categories";
    readonly refs: readonly string[];
    readonly effect:
      { readonly kind: "percentage"; readonly value: number } | { readonly kind: "free" };
  } | null;
  readonly maxUsesPerOrder: number | null;
  readonly countries: readonly string[] | null;
  readonly maxShippingRateMinor: number | null;
  readonly minimumRequirement:
    | { readonly kind: "none" }
    | { readonly kind: "amount"; readonly amountMinor: number }
    | { readonly kind: "quantity"; readonly quantity: number };
  readonly customerEligibility:
    | { readonly kind: "all" }
    | { readonly kind: "customers"; readonly customerRefs: readonly string[] };
  readonly usageLimit: number | null;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: {
    readonly product: boolean;
    readonly order: boolean;
    readonly shipping: boolean;
  };
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly usageCount: number;
}

const toScope = (scope: string): "products" | "categories" =>
  scope === "category" ? "categories" : "products";
const fromScope = (scope: "products" | "categories"): "product" | "category" =>
  scope === "categories" ? "category" : "product";

/** Shopify's four types, read off the promotion's rule. */
export function discountTypeOf(promotion: Promotion): DiscountType {
  if (promotion.rule.reward.type === "free_shipping") return "free_shipping";
  if (promotion.rule.type === "buy_x_get_y") return "buy_x_get_y";
  return promotion.rule.condition.scope === "cart" ? "amount_off_order" : "amount_off_products";
}

/** A promotion created before Phase 2 has no method: it is a code discount when a coupon points at it. */
export function discountMethodOf(
  promotion: Promotion,
  coupon: Coupon | undefined,
): "code" | "automatic" {
  return promotion.method ?? (coupon === undefined ? "automatic" : "code");
}

/** The admin's view of one discount — never promotion or coupon internals. */
export function toDiscountDto(
  promotion: Promotion,
  coupon: Coupon | undefined,
  now: Date,
): DiscountDto {
  const type = discountTypeOf(promotion);
  const { condition, reward } = promotion.rule;
  const view = promotion.viewAt(now);
  return {
    id: promotion.id.toString(),
    type,
    method: discountMethodOf(promotion, coupon),
    title: promotion.name,
    code: coupon?.code.value ?? null,
    status: view === "archived" ? "expired" : view,
    value:
      type === "amount_off_order" || type === "amount_off_products"
        ? {
            kind: reward.type === "fixed_amount" ? "fixed_amount" : "percentage",
            amount: reward.value ?? 0,
          }
        : null,
    appliesTo:
      type === "amount_off_products"
        ? { kind: toScope(condition.scope), refs: condition.targetRefs }
        : null,
    appliesOncePerOrder: reward.appliesOncePerOrder === true,
    buys:
      type === "buy_x_get_y" && reward.buys !== undefined
        ? {
            kind: reward.buys.kind,
            value: reward.buys.value,
            scope: toScope(condition.scope),
            refs: condition.targetRefs,
          }
        : null,
    gets:
      type === "buy_x_get_y" && reward.gets !== undefined
        ? {
            quantity: reward.gets.quantity,
            scope: toScope(reward.gets.scope),
            refs: reward.gets.targetRefs,
            effect: reward.gets.effect,
          }
        : null,
    maxUsesPerOrder: reward.maxUsesPerOrder ?? null,
    countries: reward.countries ?? null,
    maxShippingRateMinor: reward.maxShippingRateMinor ?? null,
    minimumRequirement:
      condition.minimumSubtotalAmountMinor !== undefined
        ? { kind: "amount", amountMinor: condition.minimumSubtotalAmountMinor }
        : condition.minimumQuantity !== undefined
          ? { kind: "quantity", quantity: condition.minimumQuantity }
          : { kind: "none" },
    customerEligibility:
      promotion.eligibility.customerRefs === undefined
        ? { kind: "all" }
        : { kind: "customers", customerRefs: promotion.eligibility.customerRefs },
    usageLimit: coupon?.usageLimit ?? null,
    oncePerCustomer: coupon !== undefined && !coupon.multiUse,
    combinesWith: promotion.combinesWith,
    startsAt: promotion.schedule.startsAt.toISOString(),
    endsAt: promotion.schedule.endsAt?.toISOString() ?? null,
    usageCount: coupon?.usageCount ?? promotion.usageCount,
  };
}

/**
 * The Promotions fields for a discount form. A code discount is titled by its code, as in Shopify.
 * `stackable`/`priority` are legacy and fixed; combinations come from `combinesWith`.
 */
export function toPromotionFields(input: DiscountInput) {
  const name =
    input.method === "code" ? (input.code ?? "").trim().toUpperCase() : (input.title ?? "").trim();
  const minimum =
    input.type === "buy_x_get_y" || input.minimumRequirement.kind === "none"
      ? {}
      : input.minimumRequirement.kind === "amount"
        ? { minimumSubtotalAmountMinor: input.minimumRequirement.amountMinor }
        : { minimumQuantity: input.minimumRequirement.quantity };
  const customers =
    input.customerEligibility.kind === "customers"
      ? { customerRefs: input.customerEligibility.customerRefs }
      : {};
  const common = {
    name,
    stackable: false,
    priority: 0,
    startsAt: input.startsAt,
    ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
    combinesWith: input.combinesWith,
    ...minimum,
    ...customers,
  };
  switch (input.type) {
    case "amount_off_order":
      return {
        ...common,
        ruleType: "automatic" as const,
        scope: "cart" as const,
        targetRefs: [],
        rewardType: input.value!.kind,
        rewardValue: input.value!.amount,
      };
    case "amount_off_products":
      return {
        ...common,
        ruleType: "automatic" as const,
        scope: fromScope(input.appliesTo!.kind),
        targetRefs: input.appliesTo!.refs,
        rewardType: input.value!.kind,
        rewardValue: input.value!.amount,
        appliesOncePerOrder: input.appliesOncePerOrder === true,
      };
    case "free_shipping":
      return {
        ...common,
        ruleType: "automatic" as const,
        scope: "cart" as const,
        targetRefs: [],
        rewardType: "free_shipping" as const,
        ...(input.countries === undefined ? {} : { countries: input.countries }),
        ...(input.maxShippingRateMinor === undefined
          ? {}
          : { maxShippingRateMinor: input.maxShippingRateMinor }),
      };
    case "buy_x_get_y":
      return {
        ...common,
        ruleType: "buy_x_get_y" as const,
        scope: fromScope(input.buys!.scope),
        targetRefs: input.buys!.refs,
        rewardType: "buy_x_get_y" as const,
        buys: { kind: input.buys!.kind, value: input.buys!.value },
        gets: {
          quantity: input.gets!.quantity,
          scope: fromScope(input.gets!.scope),
          targetRefs: input.gets!.refs,
          effect: input.gets!.effect,
        },
        ...(input.maxUsesPerOrder === undefined ? {} : { maxUsesPerOrder: input.maxUsesPerOrder }),
      };
  }
}
