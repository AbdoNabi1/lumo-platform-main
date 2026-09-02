import { ValueObject } from "@platform/domain";

export type PromotionStatusValue =
  "draft" | "scheduled" | "active" | "paused" | "expired" | "depleted" | "cancelled" | "archived";

/** The validated lifecycle transition table (Sprint 5.1). */
const TRANSITIONS: Readonly<Record<PromotionStatusValue, readonly PromotionStatusValue[]>> = {
  draft: ["scheduled", "active", "cancelled", "archived"],
  scheduled: ["active", "cancelled", "archived"],
  active: ["paused", "expired", "depleted", "cancelled", "archived"],
  paused: ["active", "expired", "cancelled", "archived"],
  expired: ["archived"],
  depleted: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

/** Whether a transition from `from` to `to` is allowed by the promotion lifecycle's transition table. */
export function canTransitionPromotion(
  from: PromotionStatusValue,
  to: PromotionStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

interface PromotionStatusProps {
  readonly value: PromotionStatusValue;
}

/** The lifecycle state of a promotion (draft→scheduled→active→paused→expired→archived, plus depleted/cancelled). */
export class PromotionStatus extends ValueObject<PromotionStatusProps> {
  static draft(): PromotionStatus {
    return new PromotionStatus({ value: "draft" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: PromotionStatusValue): PromotionStatus {
    return new PromotionStatus({ value });
  }

  get value(): PromotionStatusValue {
    return this.props.value;
  }
}
