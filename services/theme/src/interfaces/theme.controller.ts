import type { GetTheme } from "../application/get-theme.use-case";
import type { ListThemes, ListThemesInput } from "../application/list-themes.use-case";
import type {
  AdvanceTheme,
  AdvanceThemeInput,
  CreateTheme,
  CreateThemeInput,
  ThemeIdInput,
  UpdateThemeVariables,
  UpdateThemeVariablesInput,
} from "../application/theme.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface ThemeControllerDeps {
  readonly createTheme: CreateTheme;
  readonly advanceTheme: AdvanceTheme;
  readonly updateThemeVariables: UpdateThemeVariables;
  readonly listThemes: ListThemes;
  readonly getTheme: GetTheme;
}

/** Framework-agnostic interface boundary for theme use-cases (no HTTP server). */
export class ThemeController {
  private readonly deps: ThemeControllerDeps;

  constructor(deps: ThemeControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateThemeInput): Promise<ControllerResponse> {
    return present(await this.deps.createTheme.execute(input), 201);
  }

  async advance(input: AdvanceThemeInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceTheme.execute(input), 200);
  }

  async updateVariables(input: UpdateThemeVariablesInput): Promise<ControllerResponse> {
    return present(await this.deps.updateThemeVariables.execute(input), 200);
  }

  async list(input: ListThemesInput): Promise<ControllerResponse> {
    return present(await this.deps.listThemes.execute(input), 200);
  }

  async get(input: ThemeIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getTheme.execute(input), 200);
  }
}
