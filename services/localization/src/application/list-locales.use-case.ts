import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Locale } from "../domain/locale";
import type { LocaleRepository } from "../domain/repositories";

export interface ListLocalesDeps {
  readonly locales: LocaleRepository;
}

/** Cursor-paginated locale listing. */
export class ListLocales implements UseCase<CursorPage, Paginated<Locale>, DomainError> {
  private readonly deps: ListLocalesDeps;

  constructor(deps: ListLocalesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Locale>, DomainError>> {
    return ok(await this.deps.locales.list(input));
  }
}
