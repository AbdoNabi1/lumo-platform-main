import type { Clock, IdGenerator } from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import {
  EventConsumer,
  InMemoryDeadLetterStore,
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  InMemoryProcessedEventStore,
  OutboxRelay,
  OutboxWriter,
  RetryPolicy,
  rootEventContext,
} from "@platform/messaging";
import { logger } from "@platform/utils";
import { RegisterExample } from "./application/register-example.use-case";
import { ExampleEventTranslator } from "./infrastructure/example-event-translator";
import { InMemoryExampleRepository } from "./infrastructure/in-memory-example-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { RegisterExampleController } from "./interfaces/register-example.controller";
import { ExampleRegisteredConsumer } from "./interfaces/example-registered.consumer";

export interface ExampleWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface WiredExample {
  readonly controller: RegisterExampleController;
  readonly consumer: ExampleRegisteredConsumer;
  /** Drains the outbox once (relay → publisher → consumer); returns the number published. */
  readonly drainOutbox: () => Promise<number>;
}

/**
 * Composition root for the walking skeleton — wires domain → application → in-memory repository +
 * unit of work → outbox → in-memory relay/publisher/consumer. Proves the full architecture
 * in-process: no broker, no database, no HTTP server. The serializer, id generator, and clock are
 * injected so production code never depends on test-only adapters.
 */
export function wireExample(deps: ExampleWiringDeps): WiredExample {
  const consumer = new ExampleRegisteredConsumer();
  const eventConsumer = new EventConsumer(consumer, {
    serializer: deps.serializer,
    processedEvents: new InMemoryProcessedEventStore(),
    deadLetters: new InMemoryDeadLetterStore(),
    retryPolicy: new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1, factor: 2, maxDelayMs: 10 }),
    clock: deps.clock,
    logger,
    sleep: async () => {},
  });

  const bus = new InMemoryEventBus();
  bus.subscribe(`${consumer.eventType}.v${consumer.eventVersion}`, async (record) => {
    await eventConsumer.consume(record);
  });

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ExampleEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "example",
  });
  const repository = new InMemoryExampleRepository({
    outbox: outboxWriter,
    // The template has no tenant of its own, but the envelope requires one (G-64): a generated
    // context replaces this with the per-call tenant its repository merges.
    context: rootEventContext(deps.idGenerator, "tenant-example"),
  });
  const useCase = new RegisterExample({
    examples: repository,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });
  const controller = new RegisterExampleController(useCase);

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return { controller, consumer, drainOutbox: () => relay.drainOnce() };
}
