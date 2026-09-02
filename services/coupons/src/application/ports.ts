/** Outbound seam to Promotions — Coupons only ever checks whether the promotion it authorizes is active, never computes a discount itself. */
export interface PromotionsPort {
  isActive(promotionRef: string): Promise<boolean>;
}
