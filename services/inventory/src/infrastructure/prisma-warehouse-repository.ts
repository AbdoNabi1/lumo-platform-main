import type { Database, TransactionClient } from "@platform/db";
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
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `WarehouseRepository` on the `inventory` schema — optimistic locking + same-tx outbox (ADR-0003), `(tenant_id, code)` unique on registration. */
export class PrismaWarehouseRepository implements WarehouseRepository {
  private readonly deps: PrismaWarehouseRepositoryDeps;

  constructor(deps: PrismaWarehouseRepositoryDeps) {
    this.deps = deps;
  }

  async save(warehouse: Warehouse, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
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

    await this.deps.outbox.write(warehouse.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Warehouse | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.warehouse.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : WarehouseMapper.toDomain(row);
  }

  async findByCode(code: string, tx?: unknown): Promise<Warehouse | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.warehouse.findFirst({
      where: { tenantId: this.deps.tenantId, code },
    });
    return row === null ? null : WarehouseMapper.toDomain(row);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Warehouse>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.warehouse.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => WarehouseMapper.toDomain(row)),
      limit,
      (w) => w.id.toString(),
    );
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
