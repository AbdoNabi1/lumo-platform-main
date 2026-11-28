import type { PrismaClient } from "@prisma/client";
import type { EventPublisher, PublishRecord } from "@platform/messaging";
import { runInTenantTransaction } from "../transaction";

/**
 * An `EventPublisher` whose destination is `platform.outbox` instead of a broker — the producer half
 * of `EVENT_TRANSPORT=postgres` for events that do NOT come from an aggregate transaction (Tracking
 * P1-D1: the runtime API's `POST /public/tracking/collect`). Aggregates keep using `PrismaOutboxStore`
 * inside their own transaction (ADR-0003); an accepted tracking event has no aggregate, so its own
 * single insert is the transaction, and a row is only visible to the relay once it is committed.
 *
 * The record must carry what `OutboxWriter` stamps on every envelope: `messageId` (a UUID — the row id
 * and the consumer inbox key) and `tenantId`. They are refused rather than invented, because an
 * untenanted row is un-attributable to every consumer (G-64) and a non-UUID id cannot be stored.
 *
 * Idempotent on `messageId`: appending the same id again is a no-op (`ON CONFLICT DO NOTHING`), so a
 * caller that retries after a lost response — or a replayed signed request — does not create a second
 * delivery. The insert runs with `app.tenant_id` set, which the outbox's write policy requires.
 */
export class PrismaOutboxEventPublisher implements EventPublisher {
  private readonly prisma: PrismaClient;
  private readonly now: () => Date;

  constructor(prisma: PrismaClient, now: () => Date = () => new Date()) {
    this.prisma = prisma;
    this.now = now;
  }

  async publish(record: PublishRecord): Promise<void> {
    await this.publishBatch([record]);
  }

  async publishBatch(records: readonly PublishRecord[]): Promise<void> {
    const byTenant = new Map<string, PublishRecord[]>();
    for (const record of records) {
      const tenantId = record.headers["tenantId"];
      if (tenantId === undefined || tenantId === "") {
        throw new Error(
          `PrismaOutboxEventPublisher: refusing "${record.topic}" — the record carries no tenantId header (G-64)`,
        );
      }
      const messageId = record.headers["messageId"];
      if (messageId === undefined || !UUID.test(messageId)) {
        throw new Error(
          `PrismaOutboxEventPublisher: refusing "${record.topic}" — the record's messageId header is not a UUID`,
        );
      }
      const list = byTenant.get(tenantId) ?? [];
      list.push(record);
      byTenant.set(tenantId, list);
    }

    for (const [tenantId, tenantRecords] of byTenant) {
      await runInTenantTransaction(this.prisma, tenantId, (tx) =>
        tx.outboxEntry.createMany({
          data: tenantRecords.map((record) => ({
            id: record.headers["messageId"] as string,
            topic: record.topic,
            key: record.key,
            contentType:
              record.headers["contentType"] ?? record.headers["content-type"] ?? "application/json",
            payload: new Uint8Array(record.value),
            headers: { ...record.headers },
            status: "pending",
            tenantId,
            producer: record.headers["producer"] ?? null,
            createdAt: this.now(),
          })),
          skipDuplicates: true,
        }),
      );
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
