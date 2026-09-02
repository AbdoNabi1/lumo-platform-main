import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Locale } from "../domain/locale";
import type { LocaleRepository } from "../domain/repositories";

export interface LocaleIdInput {
  readonly localeId: string;
}

export interface GetLocaleDeps {
  readonly locales: LocaleRepository;
}

/** Fetches a single locale by id. */
export class GetLocale implements UseCase<LocaleIdInput, Locale, DomainError> {
  private readonly deps: GetLocaleDeps;

  constructor(deps: GetLocaleDeps) {
    this.deps = deps;
  }

  async execute(input: LocaleIdInput): Promise<Result<Locale, DomainError>> {
    const locale = await this.deps.locales.findById(input.localeId);
    return locale === null ? err(new NotFoundError("Locale not found")) : ok(locale);
  }
}
