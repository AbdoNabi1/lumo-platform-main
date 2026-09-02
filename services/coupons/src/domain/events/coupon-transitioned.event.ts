import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { CouponStatusValue } from "../value-objects/coupon-status";

export interface CouponTransitionedData {
  readonly code: string;
  readonly promotionRef: string;
  readonly fromStatus: CouponStatusValue;
  readonly toStatus: CouponStatusValue;
}

/** Raised on every validated lifecycle transition (Sprint 5.1). The translator maps this to `coupons.coupon.<status>`. */
export class CouponTransitioned extends DomainEvent {
  readonly eventName = "coupon.transitioned";
  readonly data: CouponTransitionedData;

  constructor(props: DomainEventProps, data: CouponTransitionedData) {
    super(props);
    this.data = data;
  }
}
