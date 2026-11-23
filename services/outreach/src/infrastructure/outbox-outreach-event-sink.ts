import { type DomainEvent, UniqueEntityId } from "@platform/domain";
import type { EventContext } from "@platform/messaging";
import type { OutreachEventInput, OutreachEventSink } from "../application/events";
import { OutreachDomainEvent } from "./outreach-event-translator";
export { OutreachDomainEvent, OutreachEventTranslator } from "./outreach-event-translator";

/** The slice of `OutboxWriter` the sink needs (its transaction type is whatever the unit of work provides). */
export interface OutreachOutboxWriter {
  write(events: readonly DomainEvent[], context: EventContext, tx: never): Promise<void>;
}

/** Writes through the platform outbox with the CALLER's `tx`, so a rolled-back transaction leaves no outbox row. */
export class OutboxOutreachEventSink implements OutreachEventSink {
  constructor(private readonly writer: OutreachOutboxWriter) {}

  async emit(e: OutreachEventInput, tx?: unknown): Promise<void> {
    if (tx === undefined) throw new Error("OutboxOutreachEventSink requires the unit-of-work tx");
    const event = new OutreachDomainEvent(
      {
        eventId: e.eventId,
        aggregateId: UniqueEntityId.from(e.aggregateId),
        occurredAt: e.occurredAt,
      },
      e,
    );
    await this.writer.write(
      [event],
      { correlationId: e.eventId, causationId: e.eventId, tenantId: e.tenantId },
      tx as never,
    );
  }
}
