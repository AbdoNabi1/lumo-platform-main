import { DomainEvent, type DomainEventProps, UniqueEntityId } from "@platform/domain";
import type {
  EventContext,
  IntegrationEventDescriptor,
  IntegrationEventTranslator,
} from "@platform/messaging";
import type {
  OutreachEventInput,
  OutreachEventSink,
  OutreachEventType,
} from "../application/events";

/** A real domain event per `OutreachEventInput`, so the platform outbox pipeline can carry it unchanged. */
export class OutreachDomainEvent extends DomainEvent {
  readonly eventName: string;
  readonly input: OutreachEventInput;

  constructor(props: DomainEventProps, input: OutreachEventInput) {
    super(props);
    this.eventName = input.type;
    this.input = input;
  }
}

const AGGREGATE_TYPE: Readonly<Record<OutreachEventType, string>> = {
  "outreach.whatsapp.connected": "whatsapp_connection",
  "outreach.whatsapp.disconnected": "whatsapp_connection",
  "outreach.message.status_changed": "outbound_message",
  "outreach.whatsapp.inbound_received": "inbound_message",
  "outreach.contact.consent_changed": "contact",
  "outreach.template.status_changed": "message_template",
};

/** Pure pass-through: the canonical type is the `OutreachEventType` string, version 1 (`<type>.v1` topics). */
export class OutreachEventTranslator implements IntegrationEventTranslator {
  translate(event: unknown): IntegrationEventDescriptor | undefined {
    if (!(event instanceof OutreachDomainEvent)) return undefined;
    return {
      type: event.input.type,
      eventVersion: 1,
      aggregateType: AGGREGATE_TYPE[event.input.type],
      payload: event.input.payload,
    };
  }
}

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
