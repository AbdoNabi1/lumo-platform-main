import type { DiscountUsagePort } from "@platform/checkout";
import type { CouponsController } from "@platform/coupons";
import type { PromotionsController } from "@platform/promotions";

/**
 * Real `DiscountUsagePort` (Phase 2): counts each discount an order was placed with. A code is
 * redeemed on its coupon — keyed `${orderRef}:${couponId}`, so a retry never counts twice, and
 * carrying the guest's email in the redemption's own field (never in the customer reference) so "one use per customer" also catches a returning guest. An automatic
 * discount is counted on its promotion. Every failure is collected and thrown at the end; Checkout
 * treats this as best effort and never undoes the order over it.
 */
export class DiscountUsageAdapter implements DiscountUsagePort {
  private readonly promotions: Pick<PromotionsController, "recordUsage">;
  private readonly coupons: Pick<CouponsController, "redeem">;

  constructor(
    promotions: Pick<PromotionsController, "recordUsage">,
    coupons: Pick<CouponsController, "redeem">,
  ) {
    this.promotions = promotions;
    this.coupons = coupons;
  }

  async record(input: Parameters<DiscountUsagePort["record"]>[0]): Promise<void> {
    const failures: string[] = [];
    for (const discount of input.applied) {
      const response =
        discount.couponId !== undefined && discount.code !== undefined
          ? await this.coupons.redeem({
              tenantId: input.tenantId,
              code: discount.code,
              customerRef: input.customerRef ?? `guest:${input.orderRef}`,
              ...(input.email === undefined ? {} : { email: input.email }),
              idempotencyKey: `${input.orderRef}:${discount.couponId}`,
              orderRef: input.orderRef,
            })
          : await this.promotions.recordUsage({
              tenantId: input.tenantId,
              promotionId: discount.promotionId,
            });
      if (response.status < 200 || response.status >= 300) {
        failures.push(`${discount.promotionId}: ${response.status}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`DiscountUsageAdapter: could not record ${failures.join(", ")}`);
    }
  }
}
