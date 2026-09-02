import type { Clock } from "@platform/contracts";
import type {
  EventSerializer,
  IntegrationEvent,
  SerializedEnvelope,
} from "@platform/domain-events";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { Logger } from "@platform/utils";
import type { DeadLetterStore } from "../dlq/dead-letter-store";
import { DuplicateProcessedEventError } from "../idempotency/duplicate-processed-event-error";
import type { ProcessedEventStore } from "../idempotency/processed-event-store";
import type { RetryPolicy } from "../retry/retry-policy";
import type { EventHandler } from "./event-handler";
import type { IncomingMessage } from "./incoming-message";

export interface EventConsumerDeps<TContext = unknown> {
  readonly serializer: EventSerializer;
  readonly processedEvents: ProcessedEventStore;
  readonly deadLetters: DeadLetterStore;
  readonly retryPolicy: RetryPolicy;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Delays between retries; injected so tests stay deterministic and production controls timing. */
  readonly sleep: (ms: number) => Promise<void>;
  /**
   * Opt-in atomic capability (Sprint A0, ADR-0005): when provided, and the handler implements
   * `handleAtomic`, the handler's domain write and the processed-marker write commit inside one
   * transaction. Omit for handlers that only implement `handle` — nothing changes for them.
   */
  readonly unitOfWork?: TransactionalUnitOfWork<TContext>;
}

/**
 * Turns a raw broker message into a typed, idempotent, retried handler call. Transport-agnostic: a
 * broker adapter (Redpanda, later) feeds it `IncomingMessage`s; tests feed them directly.
 *
 * Flow: deserialize → idempotency pre-check (fast skip if already processed) → handle →
 * `recordIfNew` (atomic claim). On handler failure it retries with bounded backoff; on exhaustion
 * the message is dead-lettered and acknowledged. Idempotency is keyed by `messageId`.
 *
 * The pre-check narrows the duplicate window but cannot close it (check-then-act); the atomic
 * `recordIfNew` detects a concurrent duplicate after the fact. Handlers must therefore be
 * idempotent themselves (ADR-0005) — the production adapter closes the window fully by writing
 * the processed marker inside the handler's own transaction.
 */
export class EventConsumer<TPayload, TContext = unknown> {
  private readonly handler: EventHandler<TPayload, TContext>;
  private readonly deps: EventConsumerDeps<TContext>;

  constructor(handler: EventHandler<TPayload, TContext>, deps: EventConsumerDeps<TContext>) {
    this.handler = handler;
    this.deps = deps;
  }

  async consume(message: IncomingMessage): Promise<void> {
    const event = this.deps.serializer.deserialize<TPayload>(toSerialized(message));

    if (await this.deps.processedEvents.has(event.messageId)) {
      return;
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        if (this.handler.handleAtomic !== undefined && this.deps.unitOfWork !== undefined) {
          await this.consumeAtomic(event, message);
          return;
        }
        await this.handler.handle(event);
        const isNew = await this.deps.processedEvents.recordIfNew(
          event.messageId,
          this.deps.clock.now().toISOString(),
        );
        if (!isNew) {
          this.deps.logger.warn("integration event was concurrently processed twice", {
            messageId: event.messageId,
            topic: message.topic,
          });
        }
        return;
      } catch (error) {
        if (attempt >= this.deps.retryPolicy.maxAttempts) {
          await this.deps.deadLetters.add({
            messageId: event.messageId,
            topic: message.topic,
            value: message.value,
            headers: message.headers,
            attempts: attempt,
            error: errorMessage(error),
            failedAt: this.deps.clock.now().toISOString(),
          });
          this.deps.logger.error("integration event dead-lettered", {
            messageId: event.messageId,
            topic: message.topic,
            attempts: attempt,
          });
          return;
        }
        this.deps.logger.warn("integration event handler failed; retrying", {
          messageId: event.messageId,
          topic: message.topic,
          attempt,
        });
        await this.deps.sleep(this.deps.retryPolicy.delayForAttempt(attempt));
      }
    }
  }

  /**
   * Atomic path (opt-in, Sprint A0): runs `handleAtomic` and the processed-marker write inside one
   * transaction. If `recordIfNew` loses the race to a concurrent redelivery, throws
   * `DuplicateProcessedEventError` from inside the transaction — rolling back the handler's domain
   * write, so a lost race never leaves a half-applied effect. That specific error is swallowed here
   * (logged, not retried, not dead-lettered); anything else propagates to `consume`'s retry/DLQ
   * handling unchanged.
   */
  private async consumeAtomic(
    event: IntegrationEvent<TPayload>,
    message: IncomingMessage,
  ): Promise<void> {
    const handler = this.handler;
    const unitOfWork = this.deps.unitOfWork;
    if (handler.handleAtomic === undefined || unitOfWork === undefined) {
      throw new Error("consumeAtomic requires both handleAtomic and unitOfWork to be defined");
    }
    try {
      await unitOfWork.run(async (tx) => {
        // Called through `handler.` (not a detached local reference) so `this` stays bound
        // correctly if a real implementation's `handleAtomic` is a class method, not an arrow
        // property (@typescript-eslint/unbound-method).
        await handler.handleAtomic?.(event, tx);
        const isNew = await this.deps.processedEvents.recordIfNew(
          event.messageId,
          this.deps.clock.now().toISOString(),
          tx,
        );
        if (!isNew) {
          throw new DuplicateProcessedEventError(event.messageId);
        }
      });
    } catch (error) {
      if (error instanceof DuplicateProcessedEventError) {
        this.deps.logger.warn("integration event was concurrently processed twice", {
          messageId: event.messageId,
          topic: message.topic,
        });
        return;
      }
      throw error;
    }
  }
}

function toSerialized(message: IncomingMessage): SerializedEnvelope {
  return {
    type: message.headers.type ?? "",
    eventVersion: Number(message.headers.eventVersion ?? "0"),
    contentType: message.headers.contentType ?? "",
    data: message.value,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
