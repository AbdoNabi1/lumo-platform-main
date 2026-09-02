export { wireLocalization } from "./composition";
export type { LocalizationWiringDeps, WiredLocalization } from "./composition";
export { LocalizationController } from "./interfaces/localization.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Locale } from "./domain/locale";
export { TranslationSet } from "./domain/translation-set";
export type { LocaleRepository, TranslationSetRepository } from "./domain/repositories";
export {
  PrismaLocaleRepository,
  PrismaTranslationSetRepository,
  type PrismaLocalizationRepositoriesDeps,
} from "./infrastructure/prisma-repositories";
export { LOCALIZATION_PUBLISHED_EVENTS } from "./infrastructure/localization-event-translator";
