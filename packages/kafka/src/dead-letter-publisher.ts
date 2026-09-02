import type { Clock } from "@platform/contracts";
import type { DeadLetterStore, EventPublisher } from "@platform/messaging";
import { traceHeaders } from "./runtime-headers";

export interface DeadLetterInput {
  readonly originalTopic: string;
  readonly consumerGroup: string;
  readonly messageId: string;
  readonly key: string;
  readonly value: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly attempts: number;
  readonly error: unknown;
}

export interface DeadLetterPublisherDeps {
  readonly publisher: EventPublisher;
  readonly store: DeadLetterStore;
  readonly clock: Clock;
}

/**
 * Terminal failure sink (Step 5). Publishes the ORIGINAL bytes to `<topic>.dlq` with full
 * forensic headers (original topic, consumer group, tenant, trace context, attempt count,
 * error + stack, timestamp) AND records a `platform.dead_letters` row for operator queries and
 * byte-identical replay (doc 26 §3). Every dead-letter is an operational incident — the metrics
 * seam counts it; alerting rides G-19.
 */
export class DeadLetterPublisher {
  private readonly deps: DeadLetterPublisherDeps;

  constructor(deps: DeadLetterPublisherDeps) {
    this.deps = deps;
  }

  async publish(input: DeadLetterInput): Promise<void> {
    const failedAt = this.deps.clock.now().toISOString();
    const error = input.error instanceof Error ? input.error : new Error(String(input.error));

    await this.deps.publisher.publish({
      topic: `${input.originalTopic}.dlq`,
      key: input.key,
      value: input.value, // original bytes, verbatim — replay is byte-identical
      headers: {
        ...input.headers, // envelope headers incl. tenantId/producer/correlation survive
        ...traceHeaders(input.headers),
        "x-dlq-original-topic": input.originalTopic,
        "x-dlq-consumer-group": input.consumerGroup,
        "x-dlq-attempts": String(input.attempts),
        "x-dlq-error": error.message,
        "x-dlq-stack": (error.stack ?? "").slice(0, 4096),
        "x-dlq-failed-at": failedAt,
      },
    });

    await this.deps.store.add({
      messageId: input.messageId,
      topic: input.originalTopic,
      value: input.value,
      headers: input.headers,
      attempts: input.attempts,
      error: error.message,
      failedAt,
    });
  }
}
