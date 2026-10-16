import type { PrismaClient } from "@prisma/client";
import type { DueOutboxEntry, OutboxDeliveryQueue, OutboxStatus } from "@platform/messaging";

/**
 * `platform.outbox` read as a delivery queue, for the broker-less transport
 * (`EVENT_TRANSPORT=postgres`). The producer side is unchanged — rows are still appended by
 * `PrismaOutboxStore` inside the aggregate transaction; this adapter only takes them out.
 *
 * A row waiting on a retry carries `available_at` in the future and is excluded in the WHERE
 * clause, before `take` — so waiting rows never fill a batch (port contract). Every write is
 * conditional on `status = 'pending'`, so a second relay racing this one can cause a duplicate
 * delivery but never moves a delivered row back.
 *
 * Cross-tenant by design, like `PrismaOutboxStore`: one relay serves every tenant's rows.
 */
export class PrismaOutboxDeliveryQueue implements OutboxDeliveryQueue {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async fetchDue(limit: number, now: string): Promise<readonly DueOutboxEntry[]> {
    const rows = await this.prisma.outboxEntry.findMany({
      where: {
        status: "pending",
        OR: [{ availableAt: null }, { availableAt: { lte: new Date(now) } }],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map((row) => ({
      entry: {
        id: row.id,
        topic: row.topic,
        key: row.key,
        contentType: row.contentType,
        payload: row.payload,
        headers: row.headers as Record<string, string>,
        status: row.status as OutboxStatus,
        createdAt: row.createdAt.toISOString(),
        publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
      },
      attempts: row.attempts,
    }));
  }

  async markDelivered(ids: readonly string[], deliveredAt: string): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.outboxEntry.updateMany({
      where: { id: { in: [...ids] }, status: "pending" },
      data: { status: "published", publishedAt: new Date(deliveredAt) },
    });
  }

  async defer(id: string, attempts: number, availableAt: string): Promise<void> {
    await this.prisma.outboxEntry.updateMany({
      where: { id, status: "pending" },
      data: { attempts, availableAt: new Date(availableAt) },
    });
  }
}
