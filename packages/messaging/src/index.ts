// Publisher
export type { EventPublisher, PublishRecord } from "./publisher/event-publisher";
export { InMemoryEventBus } from "./publisher/in-memory-bus";
export type { Subscriber } from "./publisher/in-memory-bus";
export { InMemoryEventPublisher } from "./publisher/in-memory-publisher";

// Outbox (producer write-side)
export type { OutboxEntry, OutboxStatus } from "./outbox/outbox-entry";
export type { EventContext } from "./outbox/event-context";
export { rootEventContext, followOnEventContext } from "./outbox/event-context";
export type {
  IntegrationEventDescriptor,
  IntegrationEventTranslator,
} from "./outbox/integration-event-translator";
export type { OutboxStore } from "./outbox/outbox-store";
export { OutboxWriter } from "./outbox/outbox-writer";
export type { OutboxWriterDeps } from "./outbox/outbox-writer";
export { InMemoryOutboxStore } from "./outbox/in-memory-outbox-store";
export { OutboxRelay } from "./outbox/outbox-relay";
export type { OutboxRelayDeps } from "./outbox/outbox-relay";

// Consumer
export type { EventHandler } from "./consumer/event-handler";
export type { IncomingMessage } from "./consumer/incoming-message";
export { EventConsumer } from "./consumer/event-consumer";
export type { EventConsumerDeps } from "./consumer/event-consumer";

// Idempotency
export type { ProcessedEventStore } from "./idempotency/processed-event-store";
export { InMemoryProcessedEventStore } from "./idempotency/in-memory-processed-event-store";
export { DuplicateProcessedEventError } from "./idempotency/duplicate-processed-event-error";

// Retry
export { RetryPolicy } from "./retry/retry-policy";
export type { RetryPolicyOptions } from "./retry/retry-policy";

// Dead-letter queue
export type { DeadLetterEntry, DeadLetterStore } from "./dlq/dead-letter-store";
export { InMemoryDeadLetterStore } from "./dlq/in-memory-dead-letter-store";
