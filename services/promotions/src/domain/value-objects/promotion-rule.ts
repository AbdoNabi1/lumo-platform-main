import { Guard, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export type PromotionRuleType = "automatic" | "buy_x_get_y";
export type PromotionRewardType = "percentage" | "fixed_amount" | "free_shipping";
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

interface PromotionRewardProps {
  readonly type: PromotionRewardType;
  /** Percentage (0-100) for `percentage`, minor-units amount for `fixed_amount`; ignored for `free_shipping`. */
  readonly value?: number;
  readonly buyQuantity?: number;
  readonly getQuantity?: number;
}

/** The discount a matching promotion determines — a pure calculation, never applied to a price directly. */
export class PromotionReward extends ValueObject<PromotionRewardProps> {
  static create(props: PromotionRewardProps): Result<PromotionReward, ValidationError> {
    if (props.type === "percentage" && (props.value === undefined || props.value > 100)) {
      return err(
        new ValidationError("Invalid promotion reward", [
          { field: "value", message: "percentage reward must be 0-100" },
        ]),
      );
    }
    return ok(new PromotionReward(props));
  }

  /** Computes the discount amount (minor units) for a matched cart subtotal — pure. */
  discountAmountMinor(matchedSubtotalAmountMinor: number): number {
    switch (this.props.type) {
      case "percentage":
        return Math.floor((matchedSubtotalAmountMinor * (this.props.value ?? 0)) / 100);
      case "fixed_amount":
        return Math.min(this.props.value ?? 0, matchedSubtotalAmountMinor);
      case "free_shipping":
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
      (reward.buyQuantity === undefined || reward.getQuantity === undefined)
    ) {
      return err(
        new ValidationError("Invalid promotion rule", [
          { field: "reward", message: "buy_x_get_y requires buyQuantity and getQuantity" },
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
