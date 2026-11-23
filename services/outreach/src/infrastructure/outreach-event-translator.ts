import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import type { OutreachEventInput, OutreachEventType } from "../application/events";

export const OUTREACH_PUBLISHED_EVENTS = [
  "outreach.whatsapp.connected",
  "outreach.whatsapp.disconnected",
  "outreach.message.status_changed",
  "outreach.whatsapp.inbound_received",
  "outreach.contact.consent_changed",
  "outreach.template.status_changed",
] as const satisfies readonly OutreachEventType[];

export class OutreachDomainEvent extends DomainEvent {
  readonly eventName: string;
  constructor(
    props: DomainEventProps,
    readonly input: OutreachEventInput,
  ) {
    super(props);
    this.eventName = input.type;
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
