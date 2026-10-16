import type { CursorPage, Paginated } from "@platform/types";
import type { Collection } from "./collection";

/**
 * Persistence port for {@link Collection}. The optional `tx` scopes the call to the caller's
 * transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter, same
 * shape as `ProductRepository` — `Collection` carries no `tenantId` of its own.
 */
export interface CollectionRepository {
  save(collection: Collection, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Collection | null>;
  findBySlug(slug: string, tenantId: string, tx?: unknown): Promise<Collection | null>;
  /** Persists a collection already marked `deleted` (via `Collection.delete`) — same shape as `save`. */
  delete(collection: Collection, tenantId: string, tx?: unknown): Promise<void>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Collection>>;
  search(
    query: string,
    page: CursorPage,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Collection>>;
}
