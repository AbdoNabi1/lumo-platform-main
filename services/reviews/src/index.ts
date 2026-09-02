export { wireReviews } from "./composition";
export type { ReviewsWiringDeps, WiredReviews } from "./composition";
export { ReviewsController } from "./interfaces/reviews.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Review } from "./domain/review";
export type { ReviewRepository } from "./domain/review-repository";
export type { OrdersPort } from "./application/ports";
export {
  PrismaReviewRepository,
  type PrismaReviewRepositoryDeps,
} from "./infrastructure/prisma-review-repository";
export { REVIEWS_PUBLISHED_EVENTS } from "./infrastructure/reviews-event-translator";
