import type { CursorPage, Paginated } from "@platform/types";
import type { Product } from "./product";

/**
 * Persistence port for {@link Product}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3, first-context slice): `findById`/`list`/`search` take `tenantId` as an
 * explicit per-call parameter — the caller (a use case, given it by its own caller) supplies the
 * verified tenant, rather than the repository capturing one tenant at construction. `save`/
 * `findBySlug`/`findBySku`/`delete` are NOT yet converted — they still rely on the concrete Prisma
 * adapter's constructor-injected `tenantId` (`PrismaCatalogRepositoryDeps.tenantId`) during this
 * transitional period. This is a deliberately partial, method-by-method conversion within one
 * context, not an inconsistency to "fix" without reading ADR-0014 first.
 */
export interface ProductRepository {
  save(product: Product, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Product | null>;
  findBySlug(slug: string, tx?: unknown): Promise<Product | null>;
  findBySku(sku: string, tx?: unknown): Promise<Product | null>;
  /** Persists a product already marked `deleted` (via `Product.delete`) — same shape as `save`. */
  delete(product: Product, tx?: unknown): Promise<void>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Product>>;
  /** Case-insensitive substring match on name/sku/slug (a stopgap, not ranked search — Search context owns that, ADR-0020). */
  search(
    query: string,
    page: CursorPage,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Product>>;
}
