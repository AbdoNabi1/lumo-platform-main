import { ValueObject } from "@platform/domain";

export type CouponStatusValue = "active" | "disabled" | "expired" | "depleted";

/** The validated lifecycle transition table (Sprint 5.1). */
const TRANSITIONS: Readonly<Record<CouponStatusValue, readonly CouponStatusValue[]>> = {
  active: ["disabled", "expired", "depleted"],
  disabled: ["active", "expired"],
  expired: [],
  depleted: [],
};

/** Whether a transition from `from` to `to` is allowed by the coupon lifecycle's transition table. */
export function canTransitionCoupon(from: CouponStatusValue, to: CouponStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface CouponStatusProps {
  readonly value: CouponStatusValue;
}

/** The lifecycle state of a coupon (active→disabled→expired→depleted). */
export class CouponStatus extends ValueObject<CouponStatusProps> {
  static active(): CouponStatus {
    return new CouponStatus({ value: "active" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: CouponStatusValue): CouponStatus {
    return new CouponStatus({ value });
  }

  get value(): CouponStatusValue {
    return this.props.value;
  }
}
