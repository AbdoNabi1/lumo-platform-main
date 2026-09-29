import type { Clock } from "@platform/contracts";
import { PrismaProcessedEventStore, type Database } from "@platform/db";
import type { ProcessedEventStore } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { ProcessedUsageRecordStore } from "../application/ports";

/**
 * The inbox group `RecordUsage` keys its own dedup marker under, in `platform.inbox_processed_events`.
 *
 * The runtime's `buildProcessedConsumer` writes ITS marker into the same table, keyed
 * `(consumerGroup, messageId)`, for the same message id. The two groups therefore MUST differ: were
 * they equal, two independent mechanisms would share one key (the kernel's `has` pre-check would read
 * this marker, and a kernel `recordIfNew` would lose the insert to it).
 * `usage-recorded.consumers.test.ts` pins them apart.
 */
export const USAGE_RECORD_CONSUMER_GROUP = "licensing.usage-record";

/**
 * Durable `ProcessedUsageRecordStore` (G-79 link 3). It owns no Prisma query: it wraps the kernel's
 * `PrismaProcessedEventStore` under {@link USAGE_RECORD_CONSUMER_GROUP}, which is what keeps the
 * tenant-where guard's `processedEvent` exemption confined to that one file.
 *
 * - `hasProcessed` is only a fast path and reads through the base client, ignoring `tx`. At READ
 *   COMMITTED that sees the same committed state a read inside the transaction would (this
 *   transaction has not written the marker yet), and a read cannot make replay safe anyway.
 * - `markProcessed` is the atomic gate: an INSERT on the `(consumerGroup, messageId)` primary key,
 *   written through the caller's transaction so it commits or rolls back with the counter. The
 *   loser of a race gets `false` from `recordIfNew`; inside Postgres a unique violation has already
 *   aborted the transaction, so this throws at once and lets the caller roll back
 *   (`event-consumer.ts` `consumeAtomic` does the same).
 */
export class PrismaProcessedUsageRecordStore implements ProcessedUsageRecordStore {
  private readonly store: ProcessedEventStore;
  private readonly clock: Clock;

  constructor(prisma: Database, clock: Clock) {
    this.store = new PrismaProcessedEventStore(prisma, USAGE_RECORD_CONSUMER_GROUP);
    this.clock = clock;
  }

  async hasProcessed(recordId: string, _tx?: unknown): Promise<boolean> {
    return this.store.has(recordId);
  }

  async markProcessed(recordId: string, tx?: unknown): Promise<void> {
    if (tx === undefined) {
      // Without a transaction `recordIfNew` falls back to the base client and the marker commits on
      // its own — apart from the counter it guards. That is the bug this store exists to prevent.
      throw new Error(
        `Refusing to mark usage record "${recordId}" outside a transaction: the marker must commit with the counter`,
      );
    }
    const isNew = await this.store.recordIfNew(recordId, this.clock.now().toISOString(), tx);
    if (!isNew) {
      throw new ConcurrencyError(`Usage record "${recordId}" was already processed`);
    }
  }
}
