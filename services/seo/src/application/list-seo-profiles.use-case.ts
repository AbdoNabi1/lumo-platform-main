import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SeoProfileRepository } from "../domain/repositories";
import type { SeoProfile } from "../domain/seo-profile";

export interface ListSeoProfilesDeps {
  readonly profiles: SeoProfileRepository;
}

/** Cursor-paginated SEO-profile listing. */
export class ListSeoProfiles implements UseCase<CursorPage, Paginated<SeoProfile>, DomainError> {
  private readonly deps: ListSeoProfilesDeps;

  constructor(deps: ListSeoProfilesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<SeoProfile>, DomainError>> {
    return ok(await this.deps.profiles.list(input));
  }
}
