import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";
import type { Clock } from "@platform/contracts";
import type { EventSerializer, IntegrationEvent } from "@platform/domain-events";
import {
  DuplicateProcessedEventError,
  type EventHandler,
  type EventPublisher,
  type ProcessedEventStore,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { Logger } from "@platform/utils";
import type { DeadLetterPublisher } from "./dead-letter-publisher";
import { noopMetrics, type MessagingMetrics } from "./metrics";
import { decodeRetryHeaders, encodeRetryHeaders, traceHeaders } from "./runtime-headers";
import {
  DEFAULT_RETRY_SCHEDULE,
  delayForAttempt,
  maxAttempts,
  type RetrySchedule,
} from "./retry-schedule";

export interface KafkaConsumerRuntimeDeps<TPayload, TContext = unknown> {
  readonly kafka: Kafka;
  readonly handler: EventHandler<TPayload, TContext>;
  readonly consumerGroup: string;
  readonly serializer: EventSerializer;
  /** ADR-0005 idempotency — Postgres remains the source of truth (`PrismaProcessedEventStore`). */
  readonly processedEvents: ProcessedEventStore;
  readonly deadLetters: DeadLetterPublisher;
  /** Producer used to schedule redeliveries onto `<topic>.retry`. */
  readonly retryPublisher: EventPublisher;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics?: MessagingMetrics;
  readonly retrySchedule?: RetrySchedule;
  /** Injected so tests stay deterministic; production waits for a retry message's due time. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Opt-in atomic capability (Sprint A0, ADR-0005): when provided, and `handler` implements
   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
   * transaction. Omit for handlers that only implement `handle` — nothing changes for them.
   */
  readonly unitOfWork?: TransactionalUnitOfWork<TContext>;
}

/**
 * Production consumer runtime (Sprint 2.5, D-046). Composes the EXISTING ports — serializer,
 * `ProcessedEventStore`, DLQ — with broker-side redelivery, deliberately replacing
 * `EventConsumer`'s in-process sleep loop, which must never reach a consumer group (ADR-0005
 * note, G-9: sleeping in `eachMessage` head-of-line blocks the partition).
 *
 * Flow per message: decode headers → (retry topic only: wait until due) → deserialize →
 * `recordIfNew` claim (atomic; duplicate ⇒ ack + count) → handle → commit. On failure: attempt <
 * max ⇒ republish ORIGINAL bytes to `<topic>.retry` with attempt+due headers and ack; attempt =
 * max ⇒ DLQ publish + row, ack. The main topic never blocks; a poison message can loop at most
 * `maxAttempts` times, then rests in the DLQ.
 *
 * Idempotency order is the ADR-0005 one — fast `has` pre-check → handle → atomic `recordIfNew`:
 * recording BEFORE handling would lose a message that crashes between claim and handle (marked
 * processed, never effected). The residual concurrent-duplicate window is closed for real when
 * the handler records the marker inside its own transaction (`PrismaProcessedEventStore`
 * accepts the tx); handlers remain idempotent regardless (ADR-0005).
 */
export class KafkaConsumerRuntime<TPayload, TContext = unknown> {
  private readonly deps: KafkaConsumerRuntimeDeps<TPayload, TContext>;
  private readonly metrics: MessagingMetrics;
  private readonly schedule: RetrySchedule;
  private readonly sleep: (ms: number) => Promise<void>;
  private consumer: Consumer | null = null;
  /** H-05: the retry topic's own consumer — see `start()`. */
  private retryConsumer: Consumer | null = null;

  constructor(deps: KafkaConsumerRuntimeDeps<TPayload, TContext>) {
    this.deps = deps;
    this.metrics = deps.metrics ?? noopMetrics;
    this.schedule = deps.retrySchedule ?? DEFAULT_RETRY_SCHEDULE;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The main topic this runtime serves (`<type>.v<version>`). */
  get topic(): string {
    return `${this.deps.handler.eventType}.v${this.deps.handler.eventVersion}`;
  }

  get consumerGroup(): string {
    return this.deps.consumerGroup;
  }

  get isRunning(): boolean {
    return this.consumer !== null;
  }

  async start(): Promise<void> {
    if (this.consumer !== null) return;
    const consumer = this.deps.kafka.consumer({
      groupId: this.deps.consumerGroup,
      allowAutoTopicCreation: false,
    });
    await consumer.connect();
    await consumer.subscribe({ topics: [this.topic], fromBeginning: false });
    await consumer.run({
      eachMessage: (payload) => this.handleMessage(payload),
    });
    this.consumer = consumer;

    // H-05: the retry topic runs on its OWN consumer — own kafkajs `Consumer`, own `groupId`, own
    // `run()` loop. Previously both topics shared one consumer (`subscribe({ topics: [topic,
    // `${topic}.retry`] })`), and `handleMessage`'s `await this.sleep(wait)` for a due retry ran
    // inside that SAME consumer's `eachMessage` — with kafkajs's default `partitionsConsumedConcurrently`
    // of 1, an in-process sleep of up to `DEFAULT_RETRY_SCHEDULE`'s final delay (1h) blocked every
    // message on the main topic behind it, for this same consumer, exactly the head-of-line blocking
    // this class's own doc comment says must never happen. A distinct `groupId` (rather than a second
    // member of the same group) avoids the group-coordinator ambiguity of two members subscribing to
    // different topic sets within one Kafka consumer group; `processedEvents`/dead-letter scoping is
    // unaffected — both still key on `this.deps.consumerGroup`, unchanged.
    const retryConsumer = this.deps.kafka.consumer({
      groupId: `${this.deps.consumerGroup}.retry`,
      allowAutoTopicCreation: false,
    });
    await retryConsumer.connect();
    await retryConsumer.subscribe({ topics: [`${this.topic}.retry`], fromBeginning: false });
    await retryConsumer.run({
      eachMessage: (payload) => this.handleMessage(payload),
    });
    this.retryConsumer = retryConsumer;
  }

  async stop(): Promise<void> {
    if (this.consumer !== null) {
      await this.consumer.disconnect();
      this.consumer = null;
    }
    if (this.retryConsumer !== null) {
      await this.retryConsumer.disconnect();
      this.retryConsumer = null;
    }
  }

  /** Exposed for tests (deterministic, no broker). Production calls arrive via `run`. */
  async handleMessage(payload: EachMessagePayload): Promise<void> {
    const headers = decodeHeaderBag(payload);
    const value = payload.message.value ?? Buffer.alloc(0);
    const key = payload.message.key?.toString() ?? "";
    const retry = decodeRetryHeaders(headers);
    const attempt = retry?.attempt ?? 0;

    // Retry-topic message: wait out its remaining delay (segregated partition — main never blocks).
    if (retry !== null) {
      const wait = retry.dueAtMs - this.deps.clock.now().getTime();
      if (wait > 0) await this.sleep(wait);
    }

    const envelope = this.deps.serializer.deserialize<TPayload>({
      type: headers["type"] ?? "",
      eventVersion: Number(headers["eventVersion"] ?? "0"),
      contentType: headers["contentType"] ?? "",
      data: value,
    });

    const started = this.deps.clock.now().getTime();
    if (await this.deps.processedEvents.has(envelope.messageId)) {
      this.metrics.duplicate(this.topic, this.deps.consumerGroup);
      return; // already effected — redelivery ack'd
    }

    try {
      if (this.deps.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
        const handled = await this.handleAtomic(envelope);
        if (!handled) {
          // Lost the recordIfNew race inside the transaction — a concurrent redelivery already
          // effected this message; the domain write rolled back with it. Benign duplicate, ack.
          this.metrics.duplicate(this.topic, this.deps.consumerGroup);
          return;
        }
      } else {
        await this.deps.handler.handle(envelope);
        await this.deps.processedEvents.recordIfNew(
          envelope.messageId,
          this.deps.clock.now().toISOString(),
        );
      }
      this.metrics.processed(
        this.topic,
        this.deps.consumerGroup,
        this.deps.clock.now().getTime() - started,
      );
    } catch (error) {
      this.metrics.failed(this.topic, this.deps.consumerGroup);
      await this.scheduleRetryOrDeadLetter({
        attempt,
        key,
        value,
        headers,
        messageId: envelope.messageId,
        tenantId: envelope.tenantId,
        error,
      });
    }
  }

  /**
   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
   * transaction. Returns `false` if a concurrent redelivery won the `recordIfNew` race (the
   * transaction is rolled back in that case, per `DuplicateProcessedEventError`); returns `true` on
   * a normal commit. Any other error propagates to `handleMessage`'s retry/DLQ handling unchanged.
   */
  private async handleAtomic(envelope: IntegrationEvent<TPayload>): Promise<boolean> {
    const handler = this.deps.handler;
    const unitOfWork = this.deps.unitOfWork;
    if (handler.handleAtomic === undefined || unitOfWork === undefined) {
      throw new Error("handleAtomic requires both handler.handleAtomic and deps.unitOfWork");
    }
    try {
      await unitOfWork.run(async (tx) => {
        // Called through `handler.` (not a detached local reference) so `this` stays bound
        // correctly if a real implementation's `handleAtomic` is a class method, not an arrow
        // property (@typescript-eslint/unbound-method).
        await handler.handleAtomic?.(envelope, tx);
        const isNew = await this.deps.processedEvents.recordIfNew(
          envelope.messageId,
          this.deps.clock.now().toISOString(),
          tx,
        );
        if (!isNew) {
          throw new DuplicateProcessedEventError(envelope.messageId);
        }
      });
      return true;
    } catch (error) {
      if (error instanceof DuplicateProcessedEventError) {
        return false;
      }
      throw error;
    }
  }

  private async scheduleRetryOrDeadLetter(input: {
    readonly attempt: number;
    readonly key: string;
    readonly value: Uint8Array;
    readonly headers: Readonly<Record<string, string>>;
    readonly messageId: string;
    /** The envelope's tenant, so a retry or dead-letter line can be attributed (T10.7). */
    readonly tenantId: string;
    readonly error: unknown;
  }): Promise<void> {
    const nextAttempt = input.attempt + 1;
    if (nextAttempt > maxAttempts(this.schedule)) {
      await this.deps.deadLetters.publish({
        originalTopic: this.topic,
        consumerGroup: this.deps.consumerGroup,
        messageId: input.messageId,
        key: input.key,
        value: input.value,
        headers: input.headers,
        attempts: input.attempt,
        error: input.error,
      });
      this.metrics.deadLettered(this.topic, this.deps.consumerGroup);
      this.deps.logger.error("message dead-lettered", {
        topic: this.topic,
        consumerGroup: this.deps.consumerGroup,
        messageId: input.messageId,
        tenantId: input.tenantId,
        attempts: input.attempt,
      });
      return;
    }

    const delay = delayForAttempt(this.schedule, nextAttempt);
    await this.deps.retryPublisher.publish({
      topic: `${this.topic}.retry`,
      key: input.key,
      value: input.value, // original bytes, verbatim
      headers: {
        ...input.headers,
        ...traceHeaders(input.headers),
        ...encodeRetryHeaders({
          attempt: nextAttempt,
          dueAtMs: this.deps.clock.now().getTime() + delay,
          originalTopic: this.topic,
          consumerGroup: this.deps.consumerGroup,
        }),
      },
    });
    this.metrics.retried(this.topic, this.deps.consumerGroup, nextAttempt);
    this.deps.logger.warn("message scheduled for retry", {
      topic: this.topic,
      consumerGroup: this.deps.consumerGroup,
      messageId: input.messageId,
      tenantId: input.tenantId,
      attempt: nextAttempt,
      delayMs: delay,
    });
  }
}

function decodeHeaderBag(payload: EachMessagePayload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(payload.message.headers ?? {})) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? (value[0]?.toString() ?? "") : value.toString();
  }
  return out;
}
