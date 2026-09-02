import type { PublishRecord } from "./event-publisher";

/** A delivered-record handler registered against a topic. */
export type Subscriber = (record: PublishRecord) => Promise<void>;

/**
 * In-memory pub/sub for local development and tests. Delivers records to a topic's subscribers in
 * publish order, so per-key (per-aggregate) FIFO is preserved when the producer publishes in order;
 * cross-key ordering is not guaranteed (matching the broker contract). Not for production.
 */
export class InMemoryEventBus {
  private readonly subscribers = new Map<string, Subscriber[]>();

  subscribe(topic: string, subscriber: Subscriber): void {
    const existing = this.subscribers.get(topic) ?? [];
    existing.push(subscriber);
    this.subscribers.set(topic, existing);
  }

  async deliver(record: PublishRecord): Promise<void> {
    const subscribers = this.subscribers.get(record.topic) ?? [];
    for (const subscriber of subscribers) {
      await subscriber(record);
    }
  }
}
