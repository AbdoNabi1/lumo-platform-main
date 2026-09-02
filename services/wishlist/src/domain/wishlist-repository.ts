import type { CursorPage, Paginated } from "@platform/types";
import type { Wishlist } from "./wishlist";

/** Persistence port for {@link Wishlist}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface WishlistRepository {
  save(wishlist: Wishlist, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Wishlist | null>;
  findByCustomerRef(customerRef: string, tx?: unknown): Promise<Wishlist | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Wishlist>>;
}
