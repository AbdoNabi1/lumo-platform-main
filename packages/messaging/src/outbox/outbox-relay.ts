import type { Clock } from "@platform/contracts";
import type { EventPublisher, PublishRecord } from "../publisher/event-publisher";
import type { OutboxEntry } from "./outbox-entry";
import type { OutboxStore } from "./outbox-store";

export interface OutboxRelayDeps {
  readonly store: OutboxStore;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  /** Max entries drained per pass (default 100). */
  readonly batchSize?: number;
}

/**
 * Drains pending outbox entries, publishes them, then marks them published. Used for local
 * development and tests. In **production** Debezium (CDC) streams the outbox table directly, so
 * this relay is not deployed (docs/architecture/05 §1.1). Safe to re-run: a still-pending entry
 * re-published is deduped by idempotent consumers.
 */
export class OutboxRelay {
  private readonly deps: OutboxRelayDeps;

  constructor(deps: OutboxRelayDeps) {
    this.deps = deps;
  }

  /** Publishes one batch of pending entries; returns the number published. */
  async drainOnce(): Promise<number> {
    const batch = await this.deps.store.fetchPending(this.deps.batchSize ?? 100);
    if (batch.length === 0) {
      return 0;
    }
    await this.deps.publisher.publishBatch(batch.map(toRecord));
    await this.deps.store.markPublished(
      batch.map((entry) => entry.id),
      this.deps.clock.now().toISOString(),
    );
    return batch.length;
  }
}

function toRecord(entry: OutboxEntry): PublishRecord {
  return { topic: entry.topic, key: entry.key, value: entry.payload, headers: entry.headers };
}
