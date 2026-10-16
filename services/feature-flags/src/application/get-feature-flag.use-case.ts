import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { FeatureFlag } from "../domain/feature-flag";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";
import type { FlagIdInput } from "./feature-flag.use-cases";

export interface GetFeatureFlagDeps {
  readonly flags: FeatureFlagRepository;
}

/** Fetches a single feature flag by id. */
export class GetFeatureFlag implements UseCase<FlagIdInput, FeatureFlag, DomainError> {
  private readonly deps: GetFeatureFlagDeps;

  constructor(deps: GetFeatureFlagDeps) {
    this.deps = deps;
  }

  async execute(input: FlagIdInput): Promise<Result<FeatureFlag, DomainError>> {
    const flag = await this.deps.flags.findById(input.flagId, input.tenantId);
    return flag === null ? err(new NotFoundError("Feature flag not found")) : ok(flag);
  }
}
