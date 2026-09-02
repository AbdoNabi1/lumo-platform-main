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

export class InMemoryLocaleRepository implements LocaleRepository {
  private readonly store = new Map<string, Locale>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLocalizationRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(locale: Locale, tx?: unknown): Promise<void> {
    this.store.set(locale.id.toString(), locale);
    await this.outbox.write(locale.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Locale | null> {
    return this.store.get(id) ?? null;
  }

  async findByCode(code: string): Promise<Locale | null> {
    for (const locale of this.store.values()) {
      if (locale.code.value === code) return locale;
    }
    return null;
  }

  async list(page: CursorPage): Promise<Paginated<Locale>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemoryTranslationSetRepository implements TranslationSetRepository {
  private readonly store = new Map<string, TranslationSet>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLocalizationRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(set: TranslationSet, tx?: unknown): Promise<void> {
    this.store.set(set.id.toString(), set);
    await this.outbox.write(set.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<TranslationSet | null> {
    return this.store.get(id) ?? null;
  }

  async findByLocaleAndNamespace(
    localeRef: string,
    namespace: string,
  ): Promise<TranslationSet | null> {
    for (const set of this.store.values()) {
      if (set.localeRef === localeRef && set.namespace === namespace) return set;
    }
    return null;
  }

  async list(page: CursorPage): Promise<Paginated<TranslationSet>> {
    return paginate([...this.store.values()], page);
  }
}
