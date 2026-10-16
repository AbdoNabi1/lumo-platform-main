import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Locale } from "../domain/locale";
import type { LocaleRepository, TranslationSetRepository } from "../domain/repositories";
import type { TranslationSet } from "../domain/translation-set";

/** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
function paginate<T extends { readonly id: { toString(): string } }>(
  rows: readonly T[],
  page: CursorPage,
): Paginated<T> {
  const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
  const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
  const start = after === undefined ? 0 : sorted.findIndex((x) => x.id.toString() > after);
  const limit = normalizePageSize(page.first);
  const window = start < 0 ? [] : sorted.slice(start, start + limit + 1);
  return buildPaginatedPage(window, limit, (x) => x.id.toString());
}

export interface InMemoryLocalizationRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `LocaleRepository`. ADR-0014 (WP-10, T10.5): keyed by `(tenantId, localeId)` —
 * `Locale` carries no `tenantId` of its own, so the store must key on it explicitly or a
 * cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemoryLocaleRepository implements LocaleRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly locale: Locale }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLocalizationRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(locale: Locale, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(locale.id.toString(), { tenantId, locale });
    await this.outbox.write(locale.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Locale | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.locale : null;
  }

  async findByCode(code: string, tenantId: string): Promise<Locale | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.locale.code.value === code) return entry.locale;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Locale>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.locale);
    return paginate(rows, page);
  }
}

/**
 * In-memory `TranslationSetRepository`. ADR-0014 (WP-10, T10.5): keyed by `(tenantId, setId)` for
 * the same reason as {@link InMemoryLocaleRepository}.
 */
export class InMemoryTranslationSetRepository implements TranslationSetRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly set: TranslationSet }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLocalizationRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(set: TranslationSet, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(set.id.toString(), { tenantId, set });
    await this.outbox.write(set.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<TranslationSet | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.set : null;
  }

  async findByLocaleAndNamespace(
    localeRef: string,
    namespace: string,
    tenantId: string,
  ): Promise<TranslationSet | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        entry.set.localeRef === localeRef &&
        entry.set.namespace === namespace
      ) {
        return entry.set;
      }
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<TranslationSet>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.set);
    return paginate(rows, page);
  }
}
