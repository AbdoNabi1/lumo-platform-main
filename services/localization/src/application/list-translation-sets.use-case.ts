import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { TranslationSetRepository } from "../domain/repositories";
import type { TranslationSet } from "../domain/translation-set";

export interface ListTranslationSetsDeps {
  readonly translationSets: TranslationSetRepository;
}

/** Cursor-paginated translation-set listing. */
export class ListTranslationSets
  implements UseCase<CursorPage, Paginated<TranslationSet>, DomainError>
{
  private readonly deps: ListTranslationSetsDeps;

  constructor(deps: ListTranslationSetsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<TranslationSet>, DomainError>> {
    return ok(await this.deps.translationSets.list(input));
  }
}
