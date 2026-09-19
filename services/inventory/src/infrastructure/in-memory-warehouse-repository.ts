import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Warehouse } from "../domain/warehouse";
import type { WarehouseRepository } from "../domain/warehouse-repository";

export interface InMemoryWarehouseRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `WarehouseRepository`. Persists the aggregate and writes its events to the outbox on save (same pattern as `InMemoryInventoryItemRepository`). ADR-0014 (WP-10, T10.3): keyed by `(tenantId, warehouseId)`. */
export class InMemoryWarehouseRepository implements WarehouseRepository {
  private readonly store = new Map<string, Map<string, Warehouse>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryWarehouseRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(warehouse: Warehouse, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(warehouse.id.toString(), warehouse);
    await this.outbox.write(warehouse.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Warehouse | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  async findByCode(code: string, tenantId: string): Promise<Warehouse | null> {
    for (const warehouse of this.store.get(tenantId)?.values() ?? []) {
      if (warehouse.code === code) return warehouse;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Warehouse>> {
    const limit = normalizePageSize(page.first);
    const all = [...(this.store.get(tenantId)?.values() ?? [])].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((w) => w.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (w) => w.id.toString());
  }
}
