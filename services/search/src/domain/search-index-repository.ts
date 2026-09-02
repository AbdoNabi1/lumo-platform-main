import type { CursorPage, Paginated } from "@platform/types";
import type { SearchIndex } from "./search-index";

/** Persistence port for {@link SearchIndex}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface SearchIndexRepository {
  save(index: SearchIndex, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<SearchIndex | null>;
  findByName(name: string, tx?: unknown): Promise<SearchIndex | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<SearchIndex>>;
}
