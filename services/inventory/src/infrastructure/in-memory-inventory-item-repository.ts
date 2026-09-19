import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { InventoryItem } from "../domain/inventory-item";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";

export interface InMemoryInventoryItemRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `InventoryItemRepository`. Persists the aggregate and writes its events to the outbox
 * on save. The natural-key lookup scans the store (acceptable for the in-memory adapter).
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, itemId)`.
 */
export class InMemoryInventoryItemRepository implements InventoryItemRepository {
  private readonly store = new Map<string, Map<string, InventoryItem>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryInventoryItemRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(item: InventoryItem, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(item.id.toString(), item);
    await this.outbox.write(item.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<InventoryItem | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  async findByProductAndWarehouse(
    productId: string,
    warehouseId: string,
    tenantId: string,
  ): Promise<InventoryItem | null> {
    for (const item of this.store.get(tenantId)?.values() ?? []) {
      if (item.product.value === productId && item.warehouseId.value === warehouseId) {
        return item;
      }
    }
    return null;
  }

  async findByProduct(productId: string, tenantId: string): Promise<readonly InventoryItem[]> {
    return [...(this.store.get(tenantId)?.values() ?? [])].filter(
      (item) => item.product.value === productId,
    );
  }

  /** Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
  async findByReservationReference(
    itemId: string,
    reference: string,
    tenantId: string,
  ): Promise<InventoryItem | null> {
    const item = this.store.get(tenantId)?.get(itemId);
    if (item === undefined) return null;
    const hasMatch = item.reservations.some((r) => r.reference === reference);
    return hasMatch ? item : null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<InventoryItem>> {
    const limit = normalizePageSize(page.first);
    const all = [...(this.store.get(tenantId)?.values() ?? [])].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((i) => i.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (i) => i.id.toString());
  }
}
