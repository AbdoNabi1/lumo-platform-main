import type { OutboxEntry } from "./outbox-entry";

/**
 * Persistence port for the transactional outbox. `append` MUST run inside the same transaction as
 * the aggregate write (so the events and the state change commit atomically). The production
 * adapter (Prisma) is added with the first persistent context; local/tests use
 * `InMemoryOutboxStore`. `TTx` is the transaction context (e.g. a Prisma transaction client); the
 * in-memory store ignores it.
 *
 * Contract notes for implementations:
 * - `fetchPending` MUST return entries in insertion (`createdAt`) order so per-aggregate event
 *   order is preserved end-to-end; it makes no locking guarantee, so the polling relay must run
 *   as a **single instance** (production uses Debezium CDC instead, docs/architecture/05 §1.1 —
 *   a concurrent relay would double-publish, which consumers tolerate but should not be invited).
 * - `markPublished` entries should be pruned/archived on a retention schedule; the outbox is a
 *   queue, not an event store.
 */
export interface OutboxStore<TTx = unknown> {
  append(entries: readonly OutboxEntry[], tx: TTx): Promise<void>;
  fetchPending(limit: number): Promise<readonly OutboxEntry[]>;
  markPublished(ids: readonly string[], publishedAt: string): Promise<void>;
}
