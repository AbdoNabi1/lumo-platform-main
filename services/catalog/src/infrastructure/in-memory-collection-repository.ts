import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";

export interface InMemoryCollectionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `CollectionRepository` (Sprint 7.0). ADR-0014 (WP-10, T10.3): keyed by
 * `(tenantId, collectionId)` — see `InMemoryProductRepository`'s doc comment for why.
 */
export class InMemoryCollectionRepository implements CollectionRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly collection: Collection }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCollectionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(collection: Collection, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(collection.id.toString(), { tenantId, collection });
    await this.outbox.write(collection.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Collection | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId && !entry.collection.deleted
      ? entry.collection
      : null;
  }

  async findBySlug(slug: string, tenantId: string): Promise<Collection | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        !entry.collection.deleted &&
        entry.collection.slug.value === slug
      ) {
        return entry.collection;
      }
    }
    return null;
  }

  async delete(collection: Collection, tenantId: string, tx?: unknown): Promise<void> {
    await this.save(collection, tenantId, tx);
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Collection>> {
    return this.paginate(
      [...this.store.values()]
        .filter((entry) => entry.tenantId === tenantId && !entry.collection.deleted)
        .map((entry) => entry.collection),
      page,
    );
  }

  async search(query: string, page: CursorPage, tenantId: string): Promise<Paginated<Collection>> {
    const needle = query.toLowerCase();
    const rows = [...this.store.values()]
      .filter(
        (entry) =>
          entry.tenantId === tenantId &&
          !entry.collection.deleted &&
          (entry.collection.name.toLowerCase().includes(needle) ||
            entry.collection.slug.value.toLowerCase().includes(needle)),
      )
      .map((entry) => entry.collection);
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
