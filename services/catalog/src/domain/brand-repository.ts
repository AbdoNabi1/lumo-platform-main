import type { CursorPage, Paginated } from "@platform/types";
import type { Brand } from "./brand";

/**
 * Persistence port for {@link Brand}. The optional `tx` scopes the call to the caller's
 * transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter, same
 * shape as `ProductRepository` — `Brand` carries no `tenantId` of its own.
 */
export interface BrandRepository {
  save(brand: Brand, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Brand | null>;
  findBySlug(slug: string, tenantId: string, tx?: unknown): Promise<Brand | null>;
  /** Persists a brand already marked `deleted` (via `Brand.delete`) — same shape as `save`. */
  delete(brand: Brand, tenantId: string, tx?: unknown): Promise<void>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Brand>>;
}
