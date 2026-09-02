import type { CursorPage, Paginated } from "@platform/types";
import type { Product } from "./product";

/** Persistence port for {@link Product}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface ProductRepository {
  save(product: Product, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Product | null>;
  findBySlug(slug: string, tx?: unknown): Promise<Product | null>;
  findBySku(sku: string, tx?: unknown): Promise<Product | null>;
  /** Persists a product already marked `deleted` (via `Product.delete`) — same shape as `save`. */
  delete(product: Product, tx?: unknown): Promise<void>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Product>>;
  /** Case-insensitive substring match on name/sku/slug (a stopgap, not ranked search — Search context owns that, ADR-0020). */
  search(query: string, page: CursorPage, tx?: unknown): Promise<Paginated<Product>>;
}
