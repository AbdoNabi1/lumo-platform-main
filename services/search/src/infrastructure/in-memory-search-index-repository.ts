import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { SearchIndex } from "../domain/search-index";
import type { SearchIndexRepository } from "../domain/search-index-repository";

export interface InMemorySearchIndexRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `SearchIndexRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemorySearchIndexRepository implements SearchIndexRepository {
  private readonly store = new Map<string, SearchIndex>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySearchIndexRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(index: SearchIndex, tx?: unknown): Promise<void> {
    this.store.set(index.id.toString(), index);
    await this.outbox.write(index.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<SearchIndex | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string, _tenantId: string): Promise<SearchIndex | null> {
    for (const index of this.store.values()) {
      if (index.name === name) return index;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, _tenantId: string): Promise<Paginated<SearchIndex>> {
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
