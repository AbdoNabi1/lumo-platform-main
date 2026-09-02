import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { CouponTransitioned } from "../domain/events/coupon-transitioned.event";

/** Maps Coupons domain events to integration events. `CouponTransitioned` maps dynamically to its canonical `coupons.coupon.<status>` type. */
export class CouponsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof CouponTransitioned) {
      return {
        type: `coupons.coupon.${event.data.toStatus}`,
        eventVersion: 1,
        aggregateType: "coupon",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/**
 * Published-event contract for the Coupons context, 5 types. `coupons.coupon.created` is a reserved
 * contract entry (initial `active` state is set directly by `create()`, never via `transition()`,
 * so it is never actually emitted) — the same convention Notifications established for its own
 * initial state.
 */
export const COUPONS_PUBLISHED_EVENTS: readonly string[] = [
  "coupons.coupon.created",
  "coupons.coupon.active",
  "coupons.coupon.disabled",
  "coupons.coupon.expired",
  "coupons.coupon.depleted",
];
