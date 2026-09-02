import type { EventPublisher, PublishRecord } from "./event-publisher";
import type { InMemoryEventBus } from "./in-memory-bus";

/**
 * `EventPublisher` for local development and tests: publishes through an `InMemoryEventBus`.
 * Not for production (no durability, single process). Production uses a Redpanda adapter.
 */
export class InMemoryEventPublisher implements EventPublisher {
  private readonly bus: InMemoryEventBus;

  constructor(bus: InMemoryEventBus) {
    this.bus = bus;
  }

  async publish(record: PublishRecord): Promise<void> {
    await this.bus.deliver(record);
  }

  async publishBatch(records: readonly PublishRecord[]): Promise<void> {
    for (const record of records) {
      await this.bus.deliver(record);
    }
  }
}
