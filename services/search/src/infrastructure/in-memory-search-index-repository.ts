import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { SearchIndex } from "../domain/search-index";
import type { SearchIndexRepository } from "../domain/search-index-repository";

export interface InMemorySearchIndexRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `SearchIndexRepository`. Persists the aggregate and writes events to the outbox on
 * save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, indexId)` — `SearchIndex` carries no
 * `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak here would
 * be invisible to every isolation test.
 */
export class InMemorySearchIndexRepository implements SearchIndexRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly index: SearchIndex }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySearchIndexRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(index: SearchIndex, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(index.id.toString(), { tenantId, index });
    await this.outbox.write(index.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<SearchIndex | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.index : null;
  }

  async findByName(name: string, tenantId: string): Promise<SearchIndex | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.index.name === name) return entry.index;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<SearchIndex>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.index)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
