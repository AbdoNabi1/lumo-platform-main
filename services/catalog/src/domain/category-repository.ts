import type { CursorPage, Paginated } from "@platform/types";
import type { Category } from "./category";

/**
 * Persistence port for {@link Category}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter, same
 * shape as `ProductRepository` — `Category` carries no `tenantId` of its own.
 */
export interface CategoryRepository {
  save(category: Category, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Category | null>;
  findBySlug(slug: string, tenantId: string, tx?: unknown): Promise<Category | null>;
  /** Persists a category already marked `deleted` (via `Category.delete`) — same shape as `save`. */
  delete(category: Category, tenantId: string, tx?: unknown): Promise<void>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Category>>;
  hasChildren(id: string, tenantId: string, tx?: unknown): Promise<boolean>;
}
