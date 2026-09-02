import { CompressionTypes, type Kafka, type Producer } from "kafkajs";
import type { EventPublisher, PublishRecord } from "@platform/messaging";

export interface KafkaMessageProducerOptions {
  /** Delivery timeout per batch (ms). Default 30s. */
  readonly deliveryTimeoutMs?: number;
}

/**
 * Production `EventPublisher` on kafkajs (Sprint 2.5, D-046).
 *
 * Guarantees, mapped to the outbox contract (doc 26 §3):
 * - **Byte fidelity**: publishes the exact `value` bytes and headers handed to it — events are
 *   NEVER rebuilt on the way out (the outbox row is the envelope of record).
 * - **Ordering**: the record `key` is the aggregate id, so per-aggregate order holds within a
 *   partition; `maxInFlightRequests: 1` + idempotent producer prevents retry-induced reordering.
 * - **Exactly-once-ish**: `idempotent: true` (acks=all, no duplicates from producer retries);
 *   end-to-end effect-once still comes from consumer idempotency (ADR-0005).
 * - **Compression**: GZIP (universally supported; snappy would add a native dependency).
 * - **Graceful shutdown**: `disconnect()` flushes in-flight batches.
 *
 * Used by broker-side publishers (retry/DLQ, future direct producers). The MAIN publication
 * path for business events remains outbox → Debezium (doc 26 §3) — this producer does not
 * replace it.
 */
export class KafkaMessageProducer implements EventPublisher {
  private readonly producer: Producer;
  private connected = false;

  constructor(kafka: Kafka, options: KafkaMessageProducerOptions = {}) {
    this.producer = kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
      retry: {
        retries: 10,
        initialRetryTime: 300,
        maxRetryTime: options.deliveryTimeoutMs ?? 30_000,
      },
    });
    // H-07: tracks real broker connectivity (not just "connect() was called once") — kafkajs fires
    // this when the underlying socket drops (e.g. broker restart), which is what a health probe needs
    // to detect. See `isConnected` and apps/collector/src/main.ts's use of it.
    this.producer.on(this.producer.events.DISCONNECT, () => {
      this.connected = false;
    });
  }

  /** Best-effort liveness signal for health probes: true once `connect()` has resolved and neither
   * `disconnect()` nor a broker-side drop has happened since. */
  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }
  }

  async publish(record: PublishRecord): Promise<void> {
    await this.publishBatch([record]);
  }

  async publishBatch(records: readonly PublishRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.connect();
    const byTopic = new Map<string, PublishRecord[]>();
    for (const record of records) {
      const list = byTopic.get(record.topic) ?? [];
      list.push(record);
      byTopic.set(record.topic, list);
    }
    for (const [topic, topicRecords] of byTopic) {
      await this.producer.send({
        topic,
        compression: CompressionTypes.GZIP,
        messages: topicRecords.map((record) => ({
          key: record.key,
          value: Buffer.from(record.value), // exact outbox bytes — never rebuilt
          headers: { ...record.headers },
        })),
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
    }
  }
}
