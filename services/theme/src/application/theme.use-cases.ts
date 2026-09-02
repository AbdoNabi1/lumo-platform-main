import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Theme, type ThemeStatusValue } from "../domain/theme";
import type { ThemeRepository } from "../domain/repositories";
import { ThemeVariables } from "../domain/value-objects/theme-variables";
import type { DesignPresetProvider } from "./theme-preset.port";

export interface ThemeDeps {
  readonly themes: ThemeRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateThemeInput {
  readonly name: string;
  readonly presetKey: string;
}

export interface ThemeStatusOutput {
  readonly themeId: string;
  readonly status: string;
}

export interface CreateThemeDeps extends ThemeDeps {
  readonly presets: DesignPresetProvider;
}

/** Creates a theme in `draft` status, seeded from a Lumo Design System token preset. */
export class CreateTheme implements UseCase<CreateThemeInput, ThemeStatusOutput, DomainError> {
  private readonly deps: CreateThemeDeps;

  constructor(deps: CreateThemeDeps) {
    this.deps = deps;
  }

  async execute(input: CreateThemeInput): Promise<Result<ThemeStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<ThemeStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.themes.findByName(input.name, tx);
      if (existing !== null) {
        return err(new ConflictError(`Theme "${input.name}" already exists`));
      }
      const variables = await this.deps.presets.getPreset(input.presetKey);
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const theme = Theme.create(id, input.name, variables);
      await this.deps.themes.save(theme, tx);
      return ok({ themeId: id.toString(), status: theme.status });
    });
  }
}

export interface ThemeIdInput {
  readonly themeId: string;
}

export interface AdvanceThemeInput extends ThemeIdInput {
  readonly toStatus: ThemeStatusValue;
}

/** Generic validated transition — used for publish/archive. */
export class AdvanceTheme implements UseCase<AdvanceThemeInput, ThemeStatusOutput, DomainError> {
  private readonly deps: ThemeDeps;

  constructor(deps: ThemeDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceThemeInput): Promise<Result<ThemeStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ThemeStatusOutput, DomainError>>(async (tx) => {
      const theme = await this.deps.themes.findById(input.themeId, tx);
      if (theme === null) return err(new NotFoundError("Theme not found"));

      try {
        theme.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.themes.save(theme, tx);
      return ok({ themeId: theme.id.toString(), status: theme.status });
    });
  }
}

export interface UpdateThemeVariablesInput extends ThemeIdInput {
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
}

/** Updates a draft theme's variables. */
export class UpdateThemeVariables implements UseCase<
  UpdateThemeVariablesInput,
  ThemeStatusOutput,
  DomainError
> {
  private readonly deps: ThemeDeps;

  constructor(deps: ThemeDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateThemeVariablesInput): Promise<Result<ThemeStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ThemeStatusOutput, DomainError>>(async (tx) => {
      const theme = await this.deps.themes.findById(input.themeId, tx);
      if (theme === null) return err(new NotFoundError("Theme not found"));

      try {
        theme.updateVariables(ThemeVariables.create(input.colors, input.typography, input.spacing));
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.themes.save(theme, tx);
      return ok({ themeId: theme.id.toString(), status: theme.status });
    });
  }
}
