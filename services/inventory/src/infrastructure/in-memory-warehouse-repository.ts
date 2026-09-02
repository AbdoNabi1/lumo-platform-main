import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Warehouse } from "../domain/warehouse";
import type { WarehouseRepository } from "../domain/warehouse-repository";

export interface InMemoryWarehouseRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `WarehouseRepository`. Persists the aggregate and writes its events to the outbox on save (same pattern as `InMemoryInventoryItemRepository`). */
export class InMemoryWarehouseRepository implements WarehouseRepository {
  private readonly store = new Map<string, Warehouse>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryWarehouseRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(warehouse: Warehouse, tx?: unknown): Promise<void> {
    this.store.set(warehouse.id.toString(), warehouse);
    await this.outbox.write(warehouse.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Warehouse | null> {
    return this.store.get(id) ?? null;
  }

  async findByCode(code: string): Promise<Warehouse | null> {
    for (const warehouse of this.store.values()) {
      if (warehouse.code === code) return warehouse;
    }
    return null;
  }

  async list(page: CursorPage): Promise<Paginated<Warehouse>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((w) => w.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (w) => w.id.toString());
  }
}
