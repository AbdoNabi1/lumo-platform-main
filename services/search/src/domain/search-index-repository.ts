import type { CursorPage, Paginated } from "@platform/types";
import type { SearchIndex } from "./search-index";

/**
 * Persistence port for {@link SearchIndex}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter,
 * matching `services/catalog`'s shape. `SearchIndex` carries no `tenantId` of its own, so `save`
 * takes it as an explicit parameter (Option B) rather than reading it off the aggregate.
 */
export interface SearchIndexRepository {
  save(index: SearchIndex, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<SearchIndex | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<SearchIndex | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<SearchIndex>>;
}
