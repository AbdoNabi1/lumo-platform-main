export { wireCoupons } from "./composition";
export type { CouponsWiringDeps, WiredCoupons } from "./composition";
export { CouponsController } from "./interfaces/coupons.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Coupon } from "./domain/coupon";
export type { CouponRepository } from "./domain/coupon-repository";
export type { PromotionsPort } from "./application/ports";
export {
  PrismaCouponRepository,
  type PrismaCouponRepositoryDeps,
} from "./infrastructure/prisma-coupon-repository";
export { COUPONS_PUBLISHED_EVENTS } from "./infrastructure/coupons-event-translator";
