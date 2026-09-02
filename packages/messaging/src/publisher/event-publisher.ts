/**
 * A transport record: the serialized envelope bytes plus broker routing metadata. `key` is the
 * partition key (the aggregate id), so per-aggregate ordering holds (docs/architecture/05 §1.3).
 */
export interface PublishRecord {
  readonly topic: string;
  readonly key: string;
  readonly value: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Outbound port: publishes serialized integration events to the broker. The production adapter
 * (Redpanda) is added in the broker-wiring sprint; local/test wiring uses `InMemoryEventPublisher`.
 */
export interface EventPublisher {
  publish(record: PublishRecord): Promise<void>;
  publishBatch(records: readonly PublishRecord[]): Promise<void>;
}
