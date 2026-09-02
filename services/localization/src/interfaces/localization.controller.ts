import type { CursorPage } from "@platform/types";
import type { GetLocale, LocaleIdInput } from "../application/get-locale.use-case";
import type {
  GetTranslationSet,
  TranslationSetIdInput,
} from "../application/get-translation-set.use-case";
import type { ListLocales } from "../application/list-locales.use-case";
import type { ListTranslationSets } from "../application/list-translation-sets.use-case";
import type {
  CreateLocale,
  CreateLocaleInput,
  CreateTranslationSet,
  CreateTranslationSetInput,
  PublishTranslation,
  SetTranslation,
  SetTranslationInput,
  TranslationKeyInput,
} from "../application/localization.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface LocalizationControllerDeps {
  readonly createLocale: CreateLocale;
  readonly createTranslationSet: CreateTranslationSet;
  readonly setTranslation: SetTranslation;
  readonly publishTranslation: PublishTranslation;
  readonly listLocales: ListLocales;
  readonly getLocale: GetLocale;
  readonly listTranslationSets: ListTranslationSets;
  readonly getTranslationSet: GetTranslationSet;
}

/** Framework-agnostic interface boundary for localization use-cases (no HTTP server). */
export class LocalizationController {
  private readonly deps: LocalizationControllerDeps;

  constructor(deps: LocalizationControllerDeps) {
    this.deps = deps;
  }

  async createLocale(input: CreateLocaleInput): Promise<ControllerResponse> {
    return present(await this.deps.createLocale.execute(input), 201);
  }

  async createTranslationSet(input: CreateTranslationSetInput): Promise<ControllerResponse> {
    return present(await this.deps.createTranslationSet.execute(input), 201);
  }

  async setTranslation(input: SetTranslationInput): Promise<ControllerResponse> {
    return present(await this.deps.setTranslation.execute(input), 200);
  }

  async publishTranslation(input: TranslationKeyInput): Promise<ControllerResponse> {
    return present(await this.deps.publishTranslation.execute(input), 200);
  }

  async listLocales(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listLocales.execute(input), 200);
  }

  async getLocale(input: LocaleIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getLocale.execute(input), 200);
  }

  async listTranslationSets(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listTranslationSets.execute(input), 200);
  }

  async getTranslationSet(input: TranslationSetIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getTranslationSet.execute(input), 200);
  }
}
