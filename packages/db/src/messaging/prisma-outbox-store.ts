import type { PrismaClient } from "@prisma/client";
import type { OutboxEntry, OutboxStatus, OutboxStore } from "@platform/messaging";
import type { TransactionClient } from "../transaction";

/**
 * Production `OutboxStore` on `platform.outbox` (ADR-0003/0005, docs/architecture/05 §1.1).
 * `append` REQUIRES the caller's transaction client and fails loudly without one — an outbox row
 * outside the aggregate's transaction would silently reintroduce the dual-write bug the outbox
 * exists to exclude. `fetchPending` returns insertion order (port contract); the polling relay is
 * single-instance-only — production streams this table via Debezium instead.
 */
export class PrismaOutboxStore implements OutboxStore<TransactionClient> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async append(entries: readonly OutboxEntry[], tx: TransactionClient): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaOutboxStore.append requires the caller's transaction client (ADR-0003) — " +
          "an outbox append outside the aggregate transaction is a dual-write bug.",
      );
    }
    await tx.outboxEntry.createMany({
      data: entries.map((entry) => ({
        id: entry.id,
        topic: entry.topic,
        key: entry.key,
        contentType: entry.contentType,
        payload: new Uint8Array(entry.payload),
        headers: { ...entry.headers },
        status: entry.status,
        tenantId: entry.headers["tenantId"] ?? null,
        producer: entry.headers["producer"] ?? null,
        createdAt: new Date(entry.createdAt),
        publishedAt: entry.publishedAt === null ? null : new Date(entry.publishedAt),
      })),
    });
  }

  async fetchPending(limit: number): Promise<readonly OutboxEntry[]> {
    const rows = await this.prisma.outboxEntry.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      key: row.key,
      contentType: row.contentType,
      payload: row.payload,
      headers: row.headers as Record<string, string>,
      status: row.status as OutboxStatus,
      createdAt: row.createdAt.toISOString(),
      publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
    }));
  }

  async markPublished(ids: readonly string[], publishedAt: string): Promise<void> {
    await this.prisma.outboxEntry.updateMany({
      where: { id: { in: [...ids] }, status: "pending" },
      data: { status: "published", publishedAt: new Date(publishedAt) },
    });
  }
}
