import type { PromotionRule } from "./promotion-rule";

/** How a discount reaches a cart — a code the customer types, or automatically (Shopify's two methods). */
export type DiscountMethod = "code" | "automatic";

/** Shopify's combination classes: what a discount takes money off. */
export type DiscountClass = "product" | "order" | "shipping";

/** Which other classes of discount this one may be combined with. */
export interface CombinesWith {
  readonly product: boolean;
  readonly order: boolean;
  readonly shipping: boolean;
}

export const COMBINES_WITH_NOTHING: CombinesWith = {
  product: false,
  order: false,
  shipping: false,
};
export const COMBINES_WITH_EVERYTHING: CombinesWith = {
  product: true,
  order: true,
  shipping: true,
};

/** The class a rule belongs to: free shipping → shipping; buy X get Y or a product/category scope → product; a cart scope → order. */
export function discountClassOf(rule: PromotionRule): DiscountClass {
  if (rule.reward.type === "free_shipping") return "shipping";
  if (rule.type === "buy_x_get_y") return "product";
  return rule.condition.scope === "cart" ? "order" : "product";
}

/** Two discounts combine only when each allows the other's class. */
export function canCombine(
  a: { readonly discountClass: DiscountClass; readonly combinesWith: CombinesWith },
  b: { readonly discountClass: DiscountClass; readonly combinesWith: CombinesWith },
): boolean {
  return a.combinesWith[b.discountClass] && b.combinesWith[a.discountClass];
}
