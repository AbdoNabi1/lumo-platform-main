import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";

export interface InMemoryCollectionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `CollectionRepository` (Sprint 7.0). */
export class InMemoryCollectionRepository implements CollectionRepository {
  private readonly store = new Map<string, Collection>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCollectionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(collection: Collection, tx?: unknown): Promise<void> {
    this.store.set(collection.id.toString(), collection);
    await this.outbox.write(collection.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Collection | null> {
    const collection = this.store.get(id);
    return collection !== undefined && !collection.deleted ? collection : null;
  }

  async findBySlug(slug: string): Promise<Collection | null> {
    for (const collection of this.store.values()) {
      if (!collection.deleted && collection.slug.value === slug) return collection;
    }
    return null;
  }

  async delete(collection: Collection, tx?: unknown): Promise<void> {
    await this.save(collection, tx);
  }

  async list(page: CursorPage): Promise<Paginated<Collection>> {
    return this.paginate(
      [...this.store.values()].filter((c) => !c.deleted),
      page,
    );
  }

  async search(query: string, page: CursorPage): Promise<Paginated<Collection>> {
    const needle = query.toLowerCase();
    const rows = [...this.store.values()].filter(
      (c) =>
        !c.deleted &&
        (c.name.toLowerCase().includes(needle) || c.slug.value.toLowerCase().includes(needle)),
    );
    return this.paginate(rows, page);
  }

  private paginate(rows: readonly Collection[], page: CursorPage): Paginated<Collection> {
    const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : null;
    const filtered = after === null ? sorted : sorted.filter((c) => c.id.toString() > after);
    const limit = normalizePageSize(page.first);
    return buildPaginatedPage(filtered.slice(0, limit + 1), limit, (c) => c.id.toString());
  }
}
