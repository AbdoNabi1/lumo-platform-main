import type { CursorPage, Paginated } from "@platform/types";
import type { Cart, CartStatus } from "./cart";

export interface CartListFilter {
  readonly status?: CartStatus;
}

/** Persistence port for {@link Cart}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface CartRepository {
  save(cart: Cart, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Cart | null>;
  /** An optional `status` filter is the operator's abandoned-cart recovery view. */
  list(page: CursorPage, filter?: CartListFilter, tx?: unknown): Promise<Paginated<Cart>>;
  /**
   * The caller's current ACTIVE cart for a session (guest or customer alike — Phase 17.1). `null`
   * when the session has no active cart (a clean "no cart yet" outcome, not an error).
   *
   * No invariant in this schema currently prevents more than one active cart sharing a
   * `sessionRef` (no unique constraint — see `cart.prisma`), so this is deliberately a single-cart
   * lookup with a documented, deterministic tie-break rather than a silently-assumed uniqueness:
   * `PrismaCartRepository` picks the most-recently-updated row; `InMemoryCartRepository` picks the
   * last matching entry in insertion order. See the Phase 17.1 report for why this wasn't turned
   * into a new DB-level invariant.
   */
  findBySessionRef(sessionRef: string, tx?: unknown): Promise<Cart | null>;
}
