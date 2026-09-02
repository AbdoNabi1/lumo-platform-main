import { Kafka, logLevel } from "kafkajs";

export type { Kafka } from "kafkajs";

export { KafkaMessageProducer, type KafkaMessageProducerOptions } from "./producer";
export { KafkaConsumerRuntime, type KafkaConsumerRuntimeDeps } from "./consumer-runtime";
export {
  DeadLetterPublisher,
  type DeadLetterInput,
  type DeadLetterPublisherDeps,
} from "./dead-letter-publisher";
export {
  ConsumerSupervisor,
  type ConsumerLag,
  type ConsumerStatus,
  type SupervisedConsumer,
} from "./supervisor";
export {
  DEFAULT_RETRY_SCHEDULE,
  delayForAttempt,
  maxAttempts,
  type RetrySchedule,
} from "./retry-schedule";
export {
  decodeRetryHeaders,
  encodeRetryHeaders,
  traceHeaders,
  TRACE_HEADERS,
  type RetryHeaders,
} from "./runtime-headers";
export { noopMetrics, type MessagingMetrics } from "./metrics";

export interface KafkaClientConfig {
  readonly brokers: readonly string[];
  readonly clientId: string;
}

/** Creates the shared kafkajs client (dependency-injected config; quiet logs — ours are structured). */
export function createKafkaClient(config: KafkaClientConfig): Kafka {
  return new Kafka({
    clientId: config.clientId,
    brokers: [...config.brokers],
    logLevel: logLevel.ERROR,
  });
}
