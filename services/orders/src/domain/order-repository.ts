import type { CursorPage, Paginated } from "@platform/types";
import type { Order, OrderStatus } from "./order";

/**
 * A page request with optional filters, additive over the base {@link CursorPage} (Phase 2
 * admin-web productization — the Orders list screen's search/status filter). `status` matches
 * the order's current lifecycle status (derived from its history, never a stored column —
 * `PrismaOrderRepository` documents the resulting query technique). `search` matches the order
 * number or customer reference (case-insensitive substring).
 */
export interface OrderListQuery extends CursorPage {
  readonly status?: OrderStatus;
  readonly search?: string;
}

/** Persistence port for {@link Order}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface OrderRepository {
  save(order: Order, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Order | null>;
  /** Cursor page, most-recently-placed first (id is UUIDv7 — time-ordered, D-022). */
  list(query: OrderListQuery, tenantId: string, tx?: unknown): Promise<Paginated<Order>>;
}
