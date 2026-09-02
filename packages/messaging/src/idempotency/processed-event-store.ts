/**
 * Records which integration events (by `messageId`) have been processed — the idempotency guard
 * that makes at-least-once redelivery safe (docs/architecture/05 §1.1, ADR-0005).
 *
 * Contract:
 * - `recordIfNew` MUST be atomic (a single compare-and-set): concurrent calls for the same
 *   `messageId` must yield exactly one `true`. The production adapter implements it as an
 *   INSERT guarded by a unique constraint — ideally inside the handler's own transaction (`tx`),
 *   which upgrades at-least-once delivery to exactly-once *effect* for that handler.
 * - `has` is a fast pre-check only; it is NOT a sufficient guard on its own (check-then-act
 *   races under concurrent redelivery). Correctness comes from `recordIfNew` + idempotent
 *   handlers.
 * - Implementations must plan retention: the processed set grows with total event volume, so the
 *   production adapter needs a TTL/cleanup policy (safe once the broker's redelivery window has
 *   passed). The in-memory store is unbounded and for local/tests only.
 */
export interface ProcessedEventStore {
  has(messageId: string): Promise<boolean>;
  /**
   * Records the message as processed if it was not already. Returns `true` when this call was
   * the first to record it, `false` when it was already processed (a concurrent or earlier
   * delivery won). `tx` optionally scopes the write to the handler's transaction.
   */
  recordIfNew(messageId: string, processedAt: string, tx?: unknown): Promise<boolean>;
}
