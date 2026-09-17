import type { CursorPage, Paginated } from "@platform/types";
import type { Product } from "./product";

/**
 * Persistence port for {@link Product}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter — the
 * caller (a use case, given it by its own caller) supplies the verified tenant, rather than the
 * repository capturing one tenant at construction. `Product` does not carry `tenantId` on the
 * aggregate, so `save`/`delete` take it as an explicit parameter (Option B) rather than reading it
 * off the aggregate.
 */
export interface ProductRepository {
  save(product: Product, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Product | null>;
  findBySlug(slug: string, tenantId: string, tx?: unknown): Promise<Product | null>;
  findBySku(sku: string, tenantId: string, tx?: unknown): Promise<Product | null>;
  /** Persists a product already marked `deleted` (via `Product.delete`) — same shape as `save`. */
  delete(product: Product, tenantId: string, tx?: unknown): Promise<void>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Product>>;
  /** Case-insensitive substring match on name/sku/slug (a stopgap, not ranked search — Search context owns that, ADR-0020). */
  search(
    query: string,
    page: CursorPage,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Product>>;
}
