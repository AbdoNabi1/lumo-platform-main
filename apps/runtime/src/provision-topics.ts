import { createKafkaClient } from "@platform/kafka";
import { logger } from "@platform/utils";
import { z } from "zod";
import { provisionTopics, type TopicAdmin } from "./kafka-topics/provision";
import { topicInventory } from "./kafka-topics/topic-inventory";

/**
 * Creates every Kafka topic the platform needs (G-80), from the one inventory in
 * `kafka-topics/topic-inventory.ts`. Idempotent; exits non-zero if any topic could not be created.
 *
 *     node --import tsx src/provision-topics.ts
 *
 * Reads ONLY its Kafka variables — not the full runtime config — so it can run as a pre-deploy step
 * without a database or Redis:
 * - `KAFKA_BROKERS` (comma-separated, same as the runtime), `KAFKA_CLIENT_ID`;
 * - `KAFKA_TOPIC_PARTITIONS` (default 1): partitions for a CONSUMED topic and its `.retry`; every
 *   other topic gets 1 (see `Partitioning` in `kafka-topics/topic-inventory.ts` for why);
 * - `KAFKA_TOPIC_REPLICATION_FACTOR` (default 1): the single-broker default.
 */
const ProvisionEnv = z.object({
  KAFKA_BROKERS: z.string().min(1).default("localhost:19092"),
  KAFKA_CLIENT_ID: z.string().min(1).default("morbeh-topic-provisioner"),
  KAFKA_TOPIC_PARTITIONS: z.coerce.number().int().positive().default(1),
  KAFKA_TOPIC_REPLICATION_FACTOR: z.coerce.number().int().positive().default(1),
});

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = ProvisionEnv.parse(env);
  const specs = topicInventory();
  const kafka = createKafkaClient({
    clientId: config.KAFKA_CLIENT_ID,
    brokers: config.KAFKA_BROKERS.split(","),
  });
  const admin: TopicAdmin = kafka.admin();
  const report = await provisionTopics(admin, specs, {
    partitions: config.KAFKA_TOPIC_PARTITIONS,
    replicationFactor: config.KAFKA_TOPIC_REPLICATION_FACTOR,
  });
  for (const topic of report.created) logger.info("topic created", { topic });
  for (const { topic, error } of report.failed) logger.error("topic FAILED", { topic, error });
  logger.info("topic provisioning finished", {
    total: specs.length,
    created: report.created.length,
    existing: report.existing.length,
    failed: report.failed.length,
  });
  return report.failed.length === 0 ? 0 : 1;
}

if (
  process.argv[1]?.endsWith("provision-topics.ts") ||
  process.argv[1]?.endsWith("provision-topics.js")
) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      logger.error("topic provisioning crashed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    },
  );
}
