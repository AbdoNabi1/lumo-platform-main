import type { Admin, Kafka } from "kafkajs";
import type { HealthCheck } from "@platform/health";
import type { Logger } from "@platform/utils";

/** What the supervisor manages — satisfied by `KafkaConsumerRuntime`. */
export interface SupervisedConsumer {
  readonly topic: string;
  readonly consumerGroup: string;
  readonly isRunning: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ConsumerStatus {
  readonly topic: string;
  readonly consumerGroup: string;
  readonly running: boolean;
}

export interface ConsumerLag {
  readonly topic: string;
  readonly consumerGroup: string;
  readonly partition: number;
  readonly lag: number;
}

/**
 * Owns the consumer fleet's lifecycle (Step 7): start/stop/restart, status, health, and lag.
 * One supervisor per process; the future worker entrypoint (transport/worker sprint) builds it
 * in its composition root, registers every context's consumers, and wires `healthCheck()` into
 * the readiness probe (doc 26 §7). Lag is measured against the broker (committed group offset
 * vs latest) via the admin client — the number Prometheus alerts on.
 */
export class ConsumerSupervisor {
  private readonly kafka: Kafka;
  private readonly logger: Logger;
  private readonly consumers: SupervisedConsumer[] = [];
  private admin: Admin | null = null;

  constructor(kafka: Kafka, logger: Logger) {
    this.kafka = kafka;
    this.logger = logger;
  }

  register(consumer: SupervisedConsumer): void {
    this.consumers.push(consumer);
  }

  async startAll(): Promise<void> {
    for (const consumer of this.consumers) {
      await consumer.start();
      this.logger.info("consumer started", {
        topic: consumer.topic,
        consumerGroup: consumer.consumerGroup,
      });
    }
  }

  async stopAll(): Promise<void> {
    for (const consumer of [...this.consumers].reverse()) {
      await consumer.stop();
      this.logger.info("consumer stopped", {
        topic: consumer.topic,
        consumerGroup: consumer.consumerGroup,
      });
    }
    if (this.admin !== null) {
      await this.admin.disconnect();
      this.admin = null;
    }
  }

  async restart(consumerGroup: string): Promise<void> {
    for (const consumer of this.consumers) {
      if (consumer.consumerGroup === consumerGroup) {
        await consumer.stop();
        await consumer.start();
        this.logger.warn("consumer restarted", { consumerGroup, topic: consumer.topic });
      }
    }
  }

  status(): readonly ConsumerStatus[] {
    return this.consumers.map((consumer) => ({
      topic: consumer.topic,
      consumerGroup: consumer.consumerGroup,
      running: consumer.isRunning,
    }));
  }

  /** Readiness: healthy only when every registered consumer is running. */
  healthCheck(): HealthCheck {
    return {
      name: "kafka-consumers",
      probe: async (): Promise<void> => {
        const stopped = this.status().filter((s) => !s.running);
        if (stopped.length > 0) {
          throw new Error(
            `consumers not running: ${stopped.map((s) => s.consumerGroup).join(", ")}`,
          );
        }
      },
    };
  }

  /** Committed-offset lag per partition for every supervised (group, topic). */
  async lag(): Promise<readonly ConsumerLag[]> {
    const admin = await this.adminClient();
    const results: ConsumerLag[] = [];
    for (const consumer of this.consumers) {
      const latest = await admin.fetchTopicOffsets(consumer.topic);
      const committed = await admin.fetchOffsets({
        groupId: consumer.consumerGroup,
        topics: [consumer.topic],
      });
      const committedByPartition = new Map(
        committed.flatMap((t) => t.partitions.map((p) => [p.partition, p.offset] as const)),
      );
      for (const partition of latest) {
        const committedOffset = Number(committedByPartition.get(partition.partition) ?? "-1");
        const latestOffset = Number(partition.offset);
        results.push({
          topic: consumer.topic,
          consumerGroup: consumer.consumerGroup,
          partition: partition.partition,
          lag: committedOffset < 0 ? latestOffset : Math.max(0, latestOffset - committedOffset),
        });
      }
    }
    return results;
  }

  private async adminClient(): Promise<Admin> {
    if (this.admin === null) {
      this.admin = this.kafka.admin();
      await this.admin.connect();
    }
    return this.admin;
  }
}
