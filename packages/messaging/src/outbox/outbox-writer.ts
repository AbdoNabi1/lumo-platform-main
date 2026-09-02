import type { Clock } from "@platform/contracts";
import type { DomainEvent } from "@platform/domain";
import type { EventSerializer, IntegrationEvent } from "@platform/domain-events";
import { topicFor } from "@platform/domain-events";
import type { EventContext } from "./event-context";
import type { OutboxEntry } from "./outbox-entry";
import type { OutboxStore } from "./outbox-store";
import type { IntegrationEventTranslator } from "./integration-event-translator";

export interface OutboxWriterDeps<TTx> {
  readonly store: OutboxStore<TTx>;
  readonly translator: IntegrationEventTranslator;
  readonly serializer: EventSerializer;
  readonly clock: Clock;
  /** The producing bounded context (e.g. `orders`); stamped on every envelope for tracing/audit. */
  readonly producer?: string;
}

/**
 * Turns an aggregate's pulled domain events into integration-event envelopes and appends them to
 * the outbox **within the caller's transaction**. Invoked by infrastructure (the persistence
 * boundary), never by the application layer — preserving `domain ← application ← messaging ←
 * infrastructure`. Domain events with no translation are skipped.
 */
export class OutboxWriter<TTx = unknown> {
  private readonly deps: OutboxWriterDeps<TTx>;

  constructor(deps: OutboxWriterDeps<TTx>) {
    this.deps = deps;
  }

  async write(events: readonly DomainEvent[], context: EventContext, tx: TTx): Promise<void> {
    const entries: OutboxEntry[] = [];
    for (const event of events) {
      const entry = this.toEntry(event, context);
      if (entry !== undefined) {
        entries.push(entry);
      }
    }
    if (entries.length === 0) {
      return;
    }
    await this.deps.store.append(entries, tx);
  }

  private toEntry(event: DomainEvent, context: EventContext): OutboxEntry | undefined {
    const descriptor = this.deps.translator.translate(event);
    if (descriptor === undefined) {
      return undefined;
    }

    const envelope: IntegrationEvent<unknown> = {
      messageId: event.eventId,
      type: descriptor.type,
      eventVersion: descriptor.eventVersion,
      aggregateId: event.aggregateId.toString(),
      aggregateType: descriptor.aggregateType,
      occurredAt: event.occurredAt.toISOString(),
      correlationId: context.correlationId,
      causationId: context.causationId,
      ...(context.tenantId !== undefined ? { tenantId: context.tenantId } : {}),
      ...(this.deps.producer !== undefined ? { producer: this.deps.producer } : {}),
      payload: descriptor.payload,
      metadata: descriptor.metadata ?? {},
    };

    const serialized = this.deps.serializer.serialize(envelope);
    return {
      id: envelope.messageId,
      topic: topicFor(envelope.type, envelope.eventVersion),
      key: envelope.aggregateId,
      contentType: serialized.contentType,
      payload: serialized.data,
      headers: {
        messageId: envelope.messageId,
        type: envelope.type,
        eventVersion: String(envelope.eventVersion),
        contentType: serialized.contentType,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
        ...(envelope.tenantId !== undefined ? { tenantId: envelope.tenantId } : {}),
        ...(envelope.producer !== undefined ? { producer: envelope.producer } : {}),
      },
      status: "pending",
      createdAt: this.deps.clock.now().toISOString(),
      publishedAt: null,
    };
  }
}
