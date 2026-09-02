import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface RewardProps {
  readonly rewardRef: string;
  readonly name: string;
  readonly costPoints: number;
}

/** A catalog reward redeemable for points — a bare reference to whatever it grants, no product/order data owned here. */
export class Reward extends ValueObject<RewardProps> {
  static create(
    rewardRef: string,
    name: string,
    costPoints: number,
  ): Result<Reward, ValidationError> {
    const guardedRef = Guard.againstEmpty(rewardRef, "rewardRef");
    if (!guardedRef.ok) return err(guardedRef.error);
    const guardedCost = Guard.againstNegative(costPoints, "costPoints");
    if (!guardedCost.ok) return err(guardedCost.error);
    return ok(new Reward({ rewardRef, name, costPoints }));
  }

  get rewardRef(): string {
    return this.props.rewardRef;
  }

  get name(): string {
    return this.props.name;
  }

  get costPoints(): number {
    return this.props.costPoints;
  }
}
