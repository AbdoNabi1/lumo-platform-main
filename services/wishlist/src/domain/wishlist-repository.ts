import type { CursorPage, Paginated } from "@platform/types";
import type { Wishlist } from "./wishlist";

/**
 * Persistence port for {@link Wishlist}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`findByCustomerRef`/`list` take `tenantId` as an explicit
 * per-call parameter, matching `services/catalog`'s first-converted-context shape. `save` is not
 * yet converted.
 */
export interface WishlistRepository {
  save(wishlist: Wishlist, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Wishlist | null>;
  findByCustomerRef(customerRef: string, tenantId: string, tx?: unknown): Promise<Wishlist | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Wishlist>>;
}
