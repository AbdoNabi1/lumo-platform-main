export { wirePromotions } from "./composition";
export type { PromotionsWiringDeps, WiredPromotions } from "./composition";
export { PromotionsController } from "./interfaces/promotions.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Promotion } from "./domain/promotion";
export type { PromotionDetermination } from "./domain/promotion";
export type { PromotionRepository } from "./domain/promotion-repository";
export type { CartSnapshot, CartSnapshotLine } from "./domain/value-objects/promotion-rule";
export {
  PrismaPromotionRepository,
  type PrismaPromotionRepositoryDeps,
} from "./infrastructure/prisma-promotion-repository";
export { PROMOTIONS_PUBLISHED_EVENTS } from "./infrastructure/promotions-event-translator";
export {
  calculateDiscounts,
  MAX_DISCOUNT_CODES,
  normalizeDiscountCode,
  type AppliedDiscount,
  type CalculateDiscountsInput,
  type CouponState,
  type DiscountCandidate,
  type DiscountCodeStatus,
  type DiscountCustomer,
  type DiscountLine,
  type DiscountRejection,
  type DiscountResult,
  type DiscountShipping,
  type LineAllocation,
} from "./domain/discount-calculator";
export {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  type CombinesWith,
  type DiscountClass,
  type DiscountMethod,
} from "./domain/value-objects/discount-settings";
export type {
  BuyXGetYBuys,
  BuyXGetYGets,
  PromotionRewardProps,
  PromotionRewardType,
  PromotionRuleType,
  PromotionScope,
} from "./domain/value-objects/promotion-rule";
export type { PromotionView } from "./domain/promotion";
