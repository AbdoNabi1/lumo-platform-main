import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { RecommendationModel } from "../domain/recommendation-model";
import type { RecommendationModelRepository } from "../domain/recommendation-model-repository";

export interface ListModelsDeps {
  readonly models: RecommendationModelRepository;
}

/** Cursor-paginated recommendation-model listing. */
export class ListModels
  implements UseCase<CursorPage, Paginated<RecommendationModel>, DomainError>
{
  private readonly deps: ListModelsDeps;

  constructor(deps: ListModelsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<RecommendationModel>, DomainError>> {
    return ok(await this.deps.models.list(input));
  }
}
