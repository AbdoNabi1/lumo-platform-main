import { Guard, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export type PromotionRuleType = "automatic" | "buy_x_get_y";
export type PromotionRewardType = "percentage" | "fixed_amount" | "free_shipping" | "buy_x_get_y";
export type PromotionScope = "cart" | "product" | "category";

export interface CartSnapshotLine {
  readonly productRef: string;
  readonly categoryRefs: readonly string[];
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
}

export interface CartSnapshot {
  readonly lines: readonly CartSnapshotLine[];
  readonly subtotalAmountMinor: number;
}

interface PromotionConditionProps {
  readonly scope: PromotionScope;
  /** Product or category refs the scope applies to; empty = cart-wide (only meaningful for `scope: "cart"`). */
  readonly targetRefs: readonly string[];
  readonly minimumQuantity?: number;
  readonly minimumSubtotalAmountMinor?: number;
}

/** Whether a cart snapshot satisfies this promotion's applicability condition — pure, no side effects. */
export class PromotionCondition extends ValueObject<PromotionConditionProps> {
  static create(props: PromotionConditionProps): PromotionCondition {
    return new PromotionCondition(props);
  }

  matches(cart: CartSnapshot): boolean {
    if (
      this.props.minimumSubtotalAmountMinor !== undefined &&
      cart.subtotalAmountMinor < this.props.minimumSubtotalAmountMinor
    ) {
      return false;
    }
    const relevantLines = this.relevantLines(cart);
    if (this.props.scope !== "cart" && relevantLines.length === 0) return false;
    if (this.props.minimumQuantity !== undefined) {
      const quantity = relevantLines.reduce((sum, line) => sum + line.quantity, 0);
      if (quantity < this.props.minimumQuantity) return false;
    }
    return true;
  }

  /** The subtotal of the lines this condition is about — the whole cart for a cart scope. */
  matchedSubtotalAmountMinor(cart: CartSnapshot): number {
    if (this.props.scope === "cart") return cart.subtotalAmountMinor;
    return this.relevantLines(cart).reduce(
      (sum, line) => sum + line.quantity * line.unitPriceAmountMinor,
      0,
    );
  }

  private relevantLines(cart: CartSnapshot): readonly CartSnapshotLine[] {
    if (this.props.scope === "cart") return cart.lines;
    if (this.props.targetRefs.length === 0) return cart.lines;
    if (this.props.scope === "product") {
      return cart.lines.filter((line) => this.props.targetRefs.includes(line.productRef));
    }
    return cart.lines.filter((line) =>
      line.categoryRefs.some((ref) => this.props.targetRefs.includes(ref)),
    );
  }

  get scope(): PromotionScope {
    return this.props.scope;
  }

  get targetRefs(): readonly string[] {
    return this.props.targetRefs;
  }

  get minimumQuantity(): number | undefined {
    return this.props.minimumQuantity;
  }

  get minimumSubtotalAmountMinor(): number | undefined {
    return this.props.minimumSubtotalAmountMinor;
  }
}

/** What the customer must buy for a buy X get Y discount: a number of items, or an amount (minor units). */
export interface BuyXGetYBuys {
  readonly kind: "quantity" | "amount";
  readonly value: number;
}

/** What the customer gets: how many items, from which products or categories, and how much off. */
export interface BuyXGetYGets {
  readonly quantity: number;
  readonly scope: "product" | "category";
  readonly targetRefs: readonly string[];
  readonly effect:
    { readonly kind: "percentage"; readonly value: number } | { readonly kind: "free" };
}

export interface PromotionRewardProps {
  readonly type: PromotionRewardType;
  /** Percentage (0-100, up to 2 decimals) for `percentage`, minor-units amount for `fixed_amount`; ignored otherwise. */
  readonly value?: number;
  /** Legacy (before Phase 2) buy X get Y quantities; kept for old rows and the platform-tools API. */
  readonly buyQuantity?: number;
  readonly getQuantity?: number;
  /** Fixed amount off products: true = once per order, spread over the matching items; false/absent = per item. */
  readonly appliesOncePerOrder?: boolean;
  /** Free shipping: ISO 3166-1 alpha-2 destinations; absent = every country. */
  readonly countries?: readonly string[];
  /** Free shipping: rates above this amount (minor units) are not made free. */
  readonly maxShippingRateMinor?: number;
  readonly buys?: BuyXGetYBuys;
  readonly gets?: BuyXGetYGets;
  /** Buy X get Y: how many times one order may use it; absent = unlimited. */
  readonly maxUsesPerOrder?: number;
}

function isPositiveInteger(value: number | undefined): boolean {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

function rewardIssues(props: PromotionRewardProps): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  switch (props.type) {
    case "percentage":
      if (props.value === undefined || props.value < 0 || props.value > 100) {
        issues.push({ field: "value", message: "percentage reward must be 0-100" });
      }
      break;
    case "fixed_amount":
      if (props.value !== undefined && (!Number.isInteger(props.value) || props.value < 0)) {
        issues.push({
          field: "value",
          message: "fixed amount must be a whole number of minor units",
        });
      }
      break;
    case "buy_x_get_y":
      if (props.buys === undefined || !isPositiveInteger(props.buys.value)) {
        issues.push({ field: "buys", message: "must say how much the customer buys" });
      }
      if (
        props.gets === undefined ||
        !isPositiveInteger(props.gets.quantity) ||
        props.gets.targetRefs.length === 0
      ) {
        issues.push({
          field: "gets",
          message: "must say which items and how many the customer gets",
        });
      } else if (
        props.gets.effect.kind === "percentage" &&
        (props.gets.effect.value <= 0 || props.gets.effect.value > 100)
      ) {
        issues.push({ field: "gets.effect", message: "percentage must be 0-100" });
      }
      if (props.maxUsesPerOrder !== undefined && !isPositiveInteger(props.maxUsesPerOrder)) {
        issues.push({ field: "maxUsesPerOrder", message: "must be a positive whole number" });
      }
      break;
    case "free_shipping":
      if (props.countries !== undefined && props.countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
        issues.push({ field: "countries", message: "must be ISO 3166-1 alpha-2 codes" });
      }
      if (
        props.maxShippingRateMinor !== undefined &&
        (!Number.isInteger(props.maxShippingRateMinor) || props.maxShippingRateMinor < 0)
      ) {
        issues.push({
          field: "maxShippingRateMinor",
          message: "must be a whole number of minor units",
        });
      }
      break;
  }
  return issues;
}

/** The discount a matching promotion determines — a pure calculation, never applied to a price directly. */
export class PromotionReward extends ValueObject<PromotionRewardProps> {
  static create(props: PromotionRewardProps): Result<PromotionReward, ValidationError> {
    const issues = rewardIssues(props);
    if (issues.length > 0) {
      return err(new ValidationError("Invalid promotion reward", issues));
    }
    return ok(new PromotionReward(props));
  }

  /**
   * Computes the discount amount (minor units) for a matched subtotal — pure. Used only by the
   * legacy `Promotion.evaluate()`; checkout uses `calculateDiscounts()`, which handles every type.
   */
  discountAmountMinor(matchedSubtotalAmountMinor: number): number {
    switch (this.props.type) {
      case "percentage":
        return Math.floor((matchedSubtotalAmountMinor * (this.props.value ?? 0)) / 100);
      case "fixed_amount":
        return Math.min(this.props.value ?? 0, matchedSubtotalAmountMinor);
      case "free_shipping":
      case "buy_x_get_y":
        return 0;
    }
  }

  get type(): PromotionRewardType {
    return this.props.type;
  }

  get value(): number | undefined {
    return this.props.value;
  }

  get buyQuantity(): number | undefined {
    return this.props.buyQuantity;
  }

  get getQuantity(): number | undefined {
    return this.props.getQuantity;
  }

  get appliesOncePerOrder(): boolean | undefined {
    return this.props.appliesOncePerOrder;
  }

  get countries(): readonly string[] | undefined {
    return this.props.countries;
  }

  get maxShippingRateMinor(): number | undefined {
    return this.props.maxShippingRateMinor;
  }

  get buys(): BuyXGetYBuys | undefined {
    return this.props.buys;
  }

  get gets(): BuyXGetYGets | undefined {
    return this.props.gets;
  }

  get maxUsesPerOrder(): number | undefined {
    return this.props.maxUsesPerOrder;
  }

  /** Every field, for persistence. */
  toProps(): PromotionRewardProps {
    return { ...this.props };
  }
}

interface PromotionRuleProps {
  readonly type: PromotionRuleType;
  readonly condition: PromotionCondition;
  readonly reward: PromotionReward;
  readonly stackable: boolean;
  readonly priority: number;
}

/** A promotion's applicability + reward, plus stacking/priority — determination logic only, no side effects. */
export class PromotionRule extends ValueObject<PromotionRuleProps> {
  static create(
    type: PromotionRuleType,
    condition: PromotionCondition,
    reward: PromotionReward,
    stackable: boolean,
    priority: number,
  ): Result<PromotionRule, ValidationError> {
    if (
      type === "buy_x_get_y" &&
      reward.type !== "buy_x_get_y" &&
      (reward.buyQuantity === undefined || reward.getQuantity === undefined)
    ) {
      return err(
        new ValidationError("Invalid promotion rule", [
          { field: "reward", message: "buy_x_get_y requires buyQuantity and getQuantity" },
        ]),
      );
    }
    if (reward.type === "buy_x_get_y" && type !== "buy_x_get_y") {
      return err(
        new ValidationError("Invalid promotion rule", [
          { field: "ruleType", message: "a buy X get Y reward needs the buy_x_get_y rule type" },
        ]),
      );
    }
    const guardedPriority = Guard.againstNegative(priority, "priority");
    if (!guardedPriority.ok) return err(guardedPriority.error);
    return ok(new PromotionRule({ type, condition, reward, stackable, priority }));
  }

  get type(): PromotionRuleType {
    return this.props.type;
  }

  get condition(): PromotionCondition {
    return this.props.condition;
  }

  get reward(): PromotionReward {
    return this.props.reward;
  }

  get stackable(): boolean {
    return this.props.stackable;
  }

  get priority(): number {
    return this.props.priority;
  }
}
