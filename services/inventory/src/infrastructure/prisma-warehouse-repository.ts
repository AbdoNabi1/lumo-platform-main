import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Warehouse } from "../domain/warehouse";
import type { WarehouseRepository } from "../domain/warehouse-repository";
import { WarehouseMapper } from "./warehouse.mapper";

export interface PrismaWarehouseRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Production `WarehouseRepository` on the `inventory` schema — optimistic locking + same-tx outbox (ADR-0003), `(tenant_id, code)` unique on registration. */
export class PrismaWarehouseRepository implements WarehouseRepository {
  private readonly deps: PrismaWarehouseRepositoryDeps;

  constructor(deps: PrismaWarehouseRepositoryDeps) {
    this.deps = deps;
  }

  async save(warehouse: Warehouse, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const warehouseId = warehouse.id.toString();

    if (warehouse.version === 0) {
      await client.warehouse.create({ data: WarehouseMapper.toRow(warehouse, tenantId) });
    } else {
      const updated = await client.warehouse.updateMany({
        where: { id: warehouseId, tenantId, version: warehouse.version },
        data: { name: warehouse.name, status: warehouse.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Warehouse ${warehouseId} was modified concurrently (expected version ${warehouse.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      warehouse.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Warehouse | null> {
    const row = await this.scoped(tenantId, tx, (client) =>
      client.warehouse.findFirst({ where: { id, tenantId } }),
    );
    return row === null ? null : WarehouseMapper.toDomain(row);
  }

  async findByCode(code: string, tenantId: string, tx?: unknown): Promise<Warehouse | null> {
    const row = await this.scoped(tenantId, tx, (client) =>
      client.warehouse.findFirst({ where: { tenantId, code } }),
    );
    return row === null ? null : WarehouseMapper.toDomain(row);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Warehouse>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await this.scoped(tenantId, tx, (client) =>
      client.warehouse.findMany({
        where: {
          tenantId,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: "asc" },
        take: limit + 1,
      }),
    );
    return buildPaginatedPage(
      rows.map((row) => WarehouseMapper.toDomain(row)),
      limit,
      (w) => w.id.toString(),
    );
  }

  /** Reuses the caller's `tx` if given, else scopes a read via `runReadScoped` (ADR-0014). */
  private scoped<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaWarehouseRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
