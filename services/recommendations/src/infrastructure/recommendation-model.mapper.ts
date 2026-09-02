import { UniqueEntityId } from "@platform/domain";
import { RecommendationModel } from "../domain/recommendation-model";
import { RecommendationStrategy } from "../domain/value-objects/recommendation-strategy";
import {
  RecommendationSet,
  type ScoredProductRef,
} from "../domain/value-objects/recommendation-set";
import { ModelStatus, type ModelStatusValue } from "../domain/value-objects/model-status";

export interface RecommendationSetJson {
  readonly anchorRef: string;
  readonly scoredRefs: readonly ScoredProductRef[];
  readonly generatedAt: string;
}

export interface RecommendationModelRow {
  readonly id: string;
  readonly name: string;
  readonly strategy: string;
  readonly status: string;
  readonly sets: readonly RecommendationSetJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link RecommendationModel}. Mapping only — no I/O. */
export class RecommendationModelMapper {
  static toDomain(row: RecommendationModelRow): RecommendationModel {
    const strategy = RecommendationStrategy.create(row.strategy);
    if (!strategy.ok) {
      throw new Error(
        `Corrupt recommendation-model row: invalid strategy (${strategy.error.message})`,
      );
    }

    return RecommendationModel.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      strategy.value,
      ModelStatus.from(row.status as ModelStatusValue),
      row.version,
      row.sets.map((s) =>
        RecommendationSet.create(s.anchorRef, s.scoredRefs, new Date(s.generatedAt)),
      ),
    );
  }

  static toRow(model: RecommendationModel, tenantId: string) {
    return {
      id: model.id.toString(),
      tenantId,
      name: model.name,
      strategy: model.strategy.value,
      status: model.status.value,
      sets: model.sets.map((s) => ({
        anchorRef: s.anchorRef,
        scoredRefs: s.scoredRefs,
        generatedAt: s.generatedAt.toISOString(),
      })),
      version: 1,
    };
  }
}
