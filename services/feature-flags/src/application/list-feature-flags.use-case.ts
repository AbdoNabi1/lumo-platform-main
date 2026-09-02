import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { FeatureFlag } from "../domain/feature-flag";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";

export interface ListFeatureFlagsDeps {
  readonly flags: FeatureFlagRepository;
}

/** Cursor-paginated feature-flag listing. */
export class ListFeatureFlags implements UseCase<CursorPage, Paginated<FeatureFlag>, DomainError> {
  private readonly deps: ListFeatureFlagsDeps;

  constructor(deps: ListFeatureFlagsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<FeatureFlag>, DomainError>> {
    return ok(await this.deps.flags.list(input));
  }
}
