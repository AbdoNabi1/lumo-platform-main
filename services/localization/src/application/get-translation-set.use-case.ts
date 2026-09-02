import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { TranslationSetRepository } from "../domain/repositories";
import type { TranslationSet } from "../domain/translation-set";
import type { TranslationKeyInput } from "./localization.use-cases";

export type TranslationSetIdInput = Pick<TranslationKeyInput, "translationSetId">;

export interface GetTranslationSetDeps {
  readonly translationSets: TranslationSetRepository;
}

/** Fetches a single translation set by id. */
export class GetTranslationSet
  implements UseCase<TranslationSetIdInput, TranslationSet, DomainError>
{
  private readonly deps: GetTranslationSetDeps;

  constructor(deps: GetTranslationSetDeps) {
    this.deps = deps;
  }

  async execute(input: TranslationSetIdInput): Promise<Result<TranslationSet, DomainError>> {
    const set = await this.deps.translationSets.findById(input.translationSetId);
    return set === null ? err(new NotFoundError("Translation set not found")) : ok(set);
  }
}
