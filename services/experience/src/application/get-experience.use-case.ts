import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Experience } from "../domain/experience";
import type { ExperienceRepository } from "../domain/repositories";
import type { ExperienceIdInput } from "./experience.use-cases";

export interface GetExperienceDeps {
  readonly experiences: ExperienceRepository;
}

/** Fetches a single experience by id. */
export class GetExperience implements UseCase<ExperienceIdInput, Experience, DomainError> {
  private readonly deps: GetExperienceDeps;

  constructor(deps: GetExperienceDeps) {
    this.deps = deps;
  }

  async execute(input: ExperienceIdInput): Promise<Result<Experience, DomainError>> {
    const experience = await this.deps.experiences.findById(input.experienceId, input.tenantId);
    return experience === null ? err(new NotFoundError("Experience not found")) : ok(experience);
  }
}
