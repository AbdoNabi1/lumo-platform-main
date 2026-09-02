import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { InventoryItem } from "../domain/inventory-item";
import type { InventoryItemRepository } from "../domain/inventory-item-repository";
import { InventoryItemMapper } from "./inventory-item.mapper";

export interface PrismaInventoryItemRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/**
 * Production `InventoryItemRepository` on the `inventory` schema. Optimistic locking on the item
 * row is the aggregate's contention guard (WHERE id AND tenant_id AND version ⇒ zero rows =
 * `ConcurrencyError`); the reservation set is replaced within the same transaction, and the
 * outbox append shares it (ADR-0003). The G-7 reservation-ledger redesign changes only this
 * adapter + mapper — the port and domain stay put.
 */
export class PrismaInventoryItemRepository implements InventoryItemRepository {
  private readonly deps: PrismaInventoryItemRepositoryDeps;

  constructor(deps: PrismaInventoryItemRepositoryDeps) {
    this.deps = deps;
  }

  async save(item: InventoryItem, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const itemId = item.id.toString();

    if (item.version === 0) {
      await client.inventoryItem.create({ data: InventoryItemMapper.toItemRow(item, tenantId) });
    } else {
      const updated = await client.inventoryItem.updateMany({
        where: { id: itemId, tenantId, version: item.version },
        data: {
          onHand: item.stockLevel.onHand,
          reserved: item.stockLevel.reserved,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `InventoryItem ${itemId} was modified concurrently (expected version ${item.version})`,
        );
      }
      // Live reservation set: releases delete rows, reserves add them — replace atomically.
      await client.reservation.deleteMany({ where: { itemId, tenantId } });
    }
    const reservations = InventoryItemMapper.toReservationRows(item, tenantId);
    if (reservations.length > 0) {
      await client.reservation.createMany({ data: reservations });
    }

    await this.deps.outbox.write(item.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<InventoryItem | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.inventoryItem.findFirst({
      where: { id, tenantId: this.deps.tenantId },
      include: { reservations: true },
    });
    return row === null ? null : InventoryItemMapper.toDomain(row, row.reservations);
  }

  async findByProductAndWarehouse(
    productId: string,
    warehouseId: string,
    tx?: unknown,
  ): Promise<InventoryItem | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.inventoryItem.findFirst({
      where: { tenantId: this.deps.tenantId, productRef: productId, warehouseId },
      include: { reservations: true },
    });
    return row === null ? null : InventoryItemMapper.toDomain(row, row.reservations);
  }

  async findByProduct(productId: string, tx?: unknown): Promise<readonly InventoryItem[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.inventoryItem.findMany({
      where: { tenantId: this.deps.tenantId, productRef: productId },
      include: { reservations: true },
    });
    return rows.map((row) => InventoryItemMapper.toDomain(row, row.reservations));
  }

  /** Scaffolding for A3's saga-activity idempotency (Sprint A0 precondition); not yet called by any use case. */
  async findByReservationReference(
    itemId: string,
    reference: string,
    tx?: unknown,
  ): Promise<InventoryItem | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const reservation = await client.reservation.findFirst({
      where: { itemId, reference, tenantId: this.deps.tenantId },
    });
    if (reservation === null) return null;
    return this.findById(reservation.itemId, tx);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<InventoryItem>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.inventoryItem.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after ? { id: { gt: after } } : {}),
      },
      include: { reservations: true },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const items = rows.map((row) => InventoryItemMapper.toDomain(row, row.reservations));
    return buildPaginatedPage(items, limit, (i) => i.id.toString());
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaInventoryItemRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
