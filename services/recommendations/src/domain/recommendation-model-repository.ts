import type { CursorPage, Paginated } from "@platform/types";
import type { RecommendationModel } from "./recommendation-model";

/** Persistence port for {@link RecommendationModel}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface RecommendationModelRepository {
  save(model: RecommendationModel, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<RecommendationModel | null>;
  findByName(name: string, tx?: unknown): Promise<RecommendationModel | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<RecommendationModel>>;
}
