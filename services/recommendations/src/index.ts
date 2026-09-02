export { wireRecommendations } from "./composition";
export type { RecommendationsWiringDeps, WiredRecommendations } from "./composition";
export { RecommendationsController } from "./interfaces/recommendations.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { RecommendationModel } from "./domain/recommendation-model";
export type { RecommendationModelRepository } from "./domain/recommendation-model-repository";
export type { SearchQueryPort } from "./application/ports";
export {
  PrismaRecommendationModelRepository,
  type PrismaRecommendationModelRepositoryDeps,
} from "./infrastructure/prisma-recommendation-model-repository";
export { RECOMMENDATIONS_PUBLISHED_EVENTS } from "./infrastructure/recommendations-event-translator";
