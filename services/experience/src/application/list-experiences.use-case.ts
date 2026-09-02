import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Experience } from "../domain/experience";
import type { ExperienceRepository } from "../domain/repositories";

export interface ListExperiencesDeps {
  readonly experiences: ExperienceRepository;
}

/** Cursor-paginated experience listing. */
export class ListExperiences implements UseCase<CursorPage, Paginated<Experience>, DomainError> {
  private readonly deps: ListExperiencesDeps;

  constructor(deps: ListExperiencesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Experience>, DomainError>> {
    return ok(await this.deps.experiences.list(input));
  }
}
