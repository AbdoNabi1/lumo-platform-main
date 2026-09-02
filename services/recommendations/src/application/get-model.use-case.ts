import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { RecommendationModel } from "../domain/recommendation-model";
import type { RecommendationModelRepository } from "../domain/recommendation-model-repository";
import type { ModelIdInput } from "./recommendation.use-cases";

export interface GetModelDeps {
  readonly models: RecommendationModelRepository;
}

/** Fetches a single recommendation model by id (including its generated sets). */
export class GetModel implements UseCase<ModelIdInput, RecommendationModel, DomainError> {
  private readonly deps: GetModelDeps;

  constructor(deps: GetModelDeps) {
    this.deps = deps;
  }

  async execute(input: ModelIdInput): Promise<Result<RecommendationModel, DomainError>> {
    const model = await this.deps.models.findById(input.modelId);
    return model === null ? err(new NotFoundError("Recommendation model not found")) : ok(model);
  }
}
