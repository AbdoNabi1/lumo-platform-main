import type { CursorPage, Paginated } from "@platform/types";
import type { Locale } from "./locale";
import type { TranslationSet } from "./translation-set";

/** Persistence port for {@link Locale}. */
export interface LocaleRepository {
  save(locale: Locale, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Locale | null>;
  findByCode(code: string, tx?: unknown): Promise<Locale | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Locale>>;
}

/** Persistence port for {@link TranslationSet}. */
export interface TranslationSetRepository {
  save(set: TranslationSet, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<TranslationSet | null>;
  findByLocaleAndNamespace(
    localeRef: string,
    namespace: string,
    tx?: unknown,
  ): Promise<TranslationSet | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<TranslationSet>>;
}
