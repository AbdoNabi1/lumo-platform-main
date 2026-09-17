import type { CursorPage, Paginated } from "@platform/types";
import type { Locale } from "./locale";
import type { TranslationSet } from "./translation-set";

/**
 * Persistence port for {@link Locale}.
 *
 * ADR-0014 (WP-10, T10.5): every method takes `tenantId` as an explicit per-call parameter.
 * `Locale` carries no `tenantId` of its own, so `save` takes it as an explicit parameter
 * (Option B) rather than reading it off the aggregate.
 */
export interface LocaleRepository {
  save(locale: Locale, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Locale | null>;
  findByCode(code: string, tenantId: string, tx?: unknown): Promise<Locale | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Locale>>;
}

/** Persistence port for {@link TranslationSet}. Same ADR-0014 shape as {@link LocaleRepository}. */
export interface TranslationSetRepository {
  save(set: TranslationSet, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<TranslationSet | null>;
  findByLocaleAndNamespace(
    localeRef: string,
    namespace: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<TranslationSet | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<TranslationSet>>;
}
