import type { CursorPage, Paginated } from "@platform/types";
import type { Brand } from "./brand";

/** Persistence port for {@link Brand}. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface BrandRepository {
  save(brand: Brand, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Brand | null>;
  findBySlug(slug: string, tx?: unknown): Promise<Brand | null>;
  /** Persists a brand already marked `deleted` (via `Brand.delete`) — same shape as `save`. */
  delete(brand: Brand, tx?: unknown): Promise<void>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Brand>>;
}
