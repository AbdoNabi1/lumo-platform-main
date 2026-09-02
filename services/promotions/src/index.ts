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
