export type OutboxStatus = "pending" | "published";

/**
 * A persisted, ready-to-publish integration event. Written to the outbox **in the same
 * transaction** as the aggregate change (exactly-once between DB and broker, docs/architecture/05).
 * Holds the serialized envelope bytes plus the routing metadata a publisher/relay needs.
 */
export interface OutboxEntry {
  /** = the integration event `messageId` (dedup + idempotency key). */
  readonly id: string;
  readonly topic: string;
  /** Partition key — the aggregate id. */
  readonly key: string;
  readonly contentType: string;
  /** Serialized envelope bytes (the broker record value). */
  readonly payload: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: OutboxStatus;
  /** RFC 3339 UTC. */
  readonly createdAt: string;
  /** RFC 3339 UTC, or null while pending. */
  readonly publishedAt: string | null;
}
