import type { CursorPage, Paginated } from "@platform/types";
import type { Locale } from "./locale";
import type { TranslationSet } from "./translation-set";

/**
 * Persistence port for {@link Locale}.
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`findByCode`/`list` take `tenantId` as an explicit per-call
 * parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet
 * converted.
 */
export interface LocaleRepository {
  save(locale: Locale, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Locale | null>;
  findByCode(code: string, tenantId: string, tx?: unknown): Promise<Locale | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Locale>>;
}

/** Persistence port for {@link TranslationSet}. Same ADR-0014 shape as {@link LocaleRepository}. */
export interface TranslationSetRepository {
  save(set: TranslationSet, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<TranslationSet | null>;
  findByLocaleAndNamespace(
    localeRef: string,
    namespace: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<TranslationSet | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<TranslationSet>>;
}
