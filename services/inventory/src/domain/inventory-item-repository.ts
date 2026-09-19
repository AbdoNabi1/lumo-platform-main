import type { CursorPage, Paginated } from "@platform/types";
import type { InventoryItem } from "./inventory-item";

/** Persistence port for {@link InventoryItem}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface InventoryItemRepository {
  save(item: InventoryItem, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<InventoryItem | null>;
  /** Looks up the item for a product at a warehouse (the natural key). */
  findByProductAndWarehouse(
    productId: string,
    warehouseId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<InventoryItem | null>;
  /** All items for a product, across every warehouse (Phase A.30 admin Products screen). */
  findByProduct(
    productId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly InventoryItem[]>;
  /**
   * Looks up the item owning an existing reservation by `(itemId, reference)` — scaffolding for
   * A3's saga-activity idempotency (Sprint A0 precondition). Returns the item so a caller can
   * inspect its live reservation set for the matching entry rather than blindly re-reserving on a
   * retried call. Not yet wired into any use case.
   */
  findByReservationReference(
    itemId: string,
    reference: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<InventoryItem | null>;
  /** Cursor-paginated listing (Sprint 7.0: generic list, by design — no free-text field exists, so no `search`). */
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<InventoryItem>>;
}
