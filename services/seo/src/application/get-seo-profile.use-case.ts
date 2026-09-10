import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { SeoProfileRepository } from "../domain/repositories";
import type { SeoProfile } from "../domain/seo-profile";

export interface ProfileIdInput {
  readonly profileId: string;
  readonly tenantId: string;
}

export interface GetSeoProfileDeps {
  readonly profiles: SeoProfileRepository;
}

/** Fetches a single SEO profile by id. */
export class GetSeoProfile implements UseCase<ProfileIdInput, SeoProfile, DomainError> {
  private readonly deps: GetSeoProfileDeps;

  constructor(deps: GetSeoProfileDeps) {
    this.deps = deps;
  }

  async execute(input: ProfileIdInput): Promise<Result<SeoProfile, DomainError>> {
    const profile = await this.deps.profiles.findById(input.profileId, input.tenantId);
    return profile === null ? err(new NotFoundError("SEO profile not found")) : ok(profile);
  }
}
