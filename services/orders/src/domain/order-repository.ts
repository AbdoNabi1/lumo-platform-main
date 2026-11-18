import type { CursorPage, Paginated } from "@platform/types";
import type { Order, OrderStatus } from "./order";

/** The largest page any order list read may ask for (export pages are 250; GET /orders caps at 100 itself). */
export const ORDER_LIST_MAX_PAGE_SIZE = 250;

/**
 * A page request with optional filters, additive over the base {@link CursorPage}. `status` matches the
 * current lifecycle status (derived, never stored). `search` matches the order number, customer ref,
 * shipping recipient name or phone. Order operations Part 1 adds Shopify's tab predicates — each one
 * the exact SQL twin of a pure function in `order-statuses.ts`.
 */
export interface OrderListQuery extends CursorPage {
  readonly status?: OrderStatus;
  readonly search?: string;
  /** true = only archived, false = only not archived, absent = both. */
  readonly archived?: boolean;
  /** true = `isOpenOrder` (never cancelled, not closed); false = the opposite. */
  readonly open?: boolean;
  /** `derivePaymentStatus(history) === "pending"`. */
  readonly paymentStatus?: "pending";
  /** Only these orders (an export of a selection, a bulk action); unknown ids match nothing. */
  readonly ids?: readonly string[];
  /** Inclusive lower bound on the entry event's time (`placed`/`created`). */
  readonly createdFrom?: Date;
  /** Exclusive upper bound on the entry event's time. */
  readonly createdTo?: Date;
  /** Order operations Part 2: only orders carrying EVERY one of these tags (case-insensitive). */
  readonly tags?: readonly string[];
}

/** Persistence port for {@link Order}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface OrderRepository {
  save(order: Order, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Order | null>;
  /** Cursor page, most-recently-placed first (id is UUIDv7 — time-ordered, D-022). */
  list(query: OrderListQuery, tenantId: string, tx?: unknown): Promise<Paginated<Order>>;
}
