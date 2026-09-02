import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { ThemeRepository } from "../domain/repositories";
import type { Theme } from "../domain/theme";

export interface ListThemesDeps {
  readonly themes: ThemeRepository;
}

/** Cursor-paginated theme listing. */
export class ListThemes implements UseCase<CursorPage, Paginated<Theme>, DomainError> {
  private readonly deps: ListThemesDeps;

  constructor(deps: ListThemesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Theme>, DomainError>> {
    return ok(await this.deps.themes.list(input));
  }
}
