import type { PromotionsPort } from "../application/ports";

/**
 * Offline in-memory stub adapter for `PromotionsPort`. Production swaps this for a real cross-context
 * adapter at the composition root (deferred to a later phase, per the report's own G-39 note) —
 * unchanged interface. Defaults to "always active" so the in-memory demo/e2e flow can redeem freely.
 */
export class InMemoryPromotionsPort implements PromotionsPort {
  private readonly inactivePromotionRefs = new Set<string>();

  /** Test/demo seam — marks a promotion as inactive so `RedeemCoupon` rejects it. */
  markInactive(promotionRef: string): void {
    this.inactivePromotionRefs.add(promotionRef);
  }

  async isActive(promotionRef: string): Promise<boolean> {
    return !this.inactivePromotionRefs.has(promotionRef);
  }
}
