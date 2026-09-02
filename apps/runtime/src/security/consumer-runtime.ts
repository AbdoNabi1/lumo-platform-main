import {
  DeadLetterPublisher,
  KafkaConsumerRuntime,
  type KafkaConsumerRuntimeDeps,
  type KafkaMessageProducer,
  type MessagingMetrics,
} from "@platform/kafka";
import { PrismaDeadLetterStore, PrismaProcessedEventStore } from "@platform/db";
import type { EventHandler } from "@platform/messaging";
import type { RuntimeCore } from "../composition";

/**
 * The `TransactionalUnitOfWork` shape `KafkaConsumerRuntime` accepts, derived from the runtime's own
 * deps rather than re-imported from `@platform/repository` — `apps/runtime` does not depend on that
 * package, and deriving keeps this helper's signature pinned to whatever the runtime actually takes.
 */
type ConsumerUnitOfWork<T, TContext> = NonNullable<
  KafkaConsumerRuntimeDeps<T, TContext>["unitOfWork"]
>;

/**
 * Builds a supervised {@link KafkaConsumerRuntime} with the platform's standard reliability envelope
 * (ADR-0005): tx-scoped Postgres **inbox idempotency** (`PrismaProcessedEventStore`), **retry topics** +
 * **dead-letter** (`DeadLetterPublisher` over `PrismaDeadLetterStore`), all keyed by `consumerGroup`. The
 * single place this plumbing is assembled for the Security runtime bindings — the H-2 identity consumer
 * fleet and the P2.0.2 principal-provisioning fleet share exactly one construction (no duplicate runtime).
 * The `producer` is shared so retries/DLQ publish through one connection the entrypoint disconnects on stop.
 *
 * `unitOfWork` is the ADR-0005 **atomic** opt-in and is deliberately optional: pass one only for a
 * handler that also implements `handleAtomic`, and the runtime then commits the handler's domain
 * write and the inbox marker in ONE transaction. Omitted (the default), the runtime takes its
 * non-atomic path — handler first, marker second, separate transactions — which is correct only for
 * handlers that are independently idempotent, since a crash between the two makes Kafka redeliver
 * an already-effected message. A handler whose effect is NOT self-idempotent (Finance's ledger
 * append mints a fresh journal id per call, and `Journal.sourceRef` carries no unique constraint)
 * must be given a `unitOfWork`, or at-least-once delivery becomes at-least-once *effect*.
 */
export function buildProcessedConsumer<T, TContext = unknown>(
  core: RuntimeCore,
  handler: EventHandler<T, TContext>,
  consumerGroup: string,
  producer: KafkaMessageProducer,
  metrics?: MessagingMetrics,
  unitOfWork?: ConsumerUnitOfWork<T, TContext>,
): KafkaConsumerRuntime<T, TContext> {
  return new KafkaConsumerRuntime<T, TContext>({
    kafka: core.kafka,
    handler,
    consumerGroup,
    serializer: core.serializer,
    processedEvents: new PrismaProcessedEventStore(core.prisma, consumerGroup),
    deadLetters: new DeadLetterPublisher({
      publisher: producer,
      store: new PrismaDeadLetterStore(core.prisma, consumerGroup, core.idGenerator),
      clock: core.clock,
    }),
    retryPublisher: producer,
    clock: core.clock,
    logger: core.logger,
    ...(metrics !== undefined ? { metrics } : {}),
    ...(unitOfWork !== undefined ? { unitOfWork } : {}),
  });
}
