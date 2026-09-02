import type { CursorPage, Paginated } from "@platform/types";
import type { Collection } from "./collection";

/** Persistence port for {@link Collection}. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface CollectionRepository {
  save(collection: Collection, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Collection | null>;
  findBySlug(slug: string, tx?: unknown): Promise<Collection | null>;
  /** Persists a collection already marked `deleted` (via `Collection.delete`) — same shape as `save`. */
  delete(collection: Collection, tx?: unknown): Promise<void>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Collection>>;
  search(query: string, page: CursorPage, tx?: unknown): Promise<Paginated<Collection>>;
}
