import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ThemeRepository } from "../domain/repositories";
import type { Theme } from "../domain/theme";
import type { ThemeIdInput } from "./theme.use-cases";

export interface GetThemeDeps {
  readonly themes: ThemeRepository;
}

/** Fetches a single theme by id. */
export class GetTheme implements UseCase<ThemeIdInput, Theme, DomainError> {
  private readonly deps: GetThemeDeps;

  constructor(deps: GetThemeDeps) {
    this.deps = deps;
  }

  async execute(input: ThemeIdInput): Promise<Result<Theme, DomainError>> {
    const theme = await this.deps.themes.findById(input.themeId);
    return theme === null ? err(new NotFoundError("Theme not found")) : ok(theme);
  }
}
