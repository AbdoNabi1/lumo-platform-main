import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Locale } from "../domain/locale";
import type { LocaleRepository } from "../domain/repositories";

export interface ListLocalesInput extends CursorPage {
  readonly tenantId: string;
}

export interface ListLocalesDeps {
  readonly locales: LocaleRepository;
}

/** Cursor-paginated locale listing. */
export class ListLocales implements UseCase<ListLocalesInput, Paginated<Locale>, DomainError> {
  private readonly deps: ListLocalesDeps;

  constructor(deps: ListLocalesDeps) {
    this.deps = deps;
  }

  async execute(input: ListLocalesInput): Promise<Result<Paginated<Locale>, DomainError>> {
    return ok(await this.deps.locales.list(input, input.tenantId));
  }
}
