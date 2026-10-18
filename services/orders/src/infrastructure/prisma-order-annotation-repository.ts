import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import { uuidsOf } from "./order-list-where";

export interface PrismaOrderAnnotationRepositoryDeps {
  readonly prisma: Database;
}

/**
 * Production {@link OrderAnnotationRepository} on `orders.orders.archived_at`: a plain `updateMany`
 * scoped by `tenantId` — no `version` condition, no history row, no outbox event (spec §1.2). Writes
 * need the unit of work's `tx`; reads use it when given, else `runReadScoped` (ADR-0014).
 */
export class PrismaOrderAnnotationRepository implements OrderAnnotationRepository {
  private readonly deps: PrismaOrderAnnotationRepositoryDeps;

  constructor(deps: PrismaOrderAnnotationRepositoryDeps) {
    this.deps = deps;
  }

  async setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly string[]> {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaOrderAnnotationRepository.setArchived requires the unit of work's transaction client (ADR-0003).",
      );
    }
    const client = tx as TransactionClient;
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return [];
    const pending = await client.order.findMany({
      where: { tenantId, id: { in: ids }, archivedAt: archivedAt === null ? { not: null } : null },
      select: { id: true },
    });
    const changed = pending.map((row) => row.id);
    if (changed.length > 0) {
      await client.order.updateMany({
        where: { tenantId, id: { in: changed } },
        data: { archivedAt },
      });
    }
    return changed;
  }

  async annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, OrderAnnotations>> {
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return new Map();
    const read = (client: TransactionClient) =>
      client.order.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, archivedAt: true },
      });
    const rows =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    return new Map(rows.map((row) => [row.id, { archivedAt: row.archivedAt }]));
  }
}
