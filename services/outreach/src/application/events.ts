import type { OutboundStatus } from "../domain/outbound-message";

export type OutreachEventType =
  | "outreach.whatsapp.connected"
  | "outreach.whatsapp.disconnected"
  | "outreach.message.status_changed"
  | "outreach.whatsapp.inbound_received"
  | "outreach.contact.consent_changed"
  | "outreach.template.status_changed";

/** Payloads carry no secrets and no message bodies. */
export interface OutreachEventPayloads {
  "outreach.whatsapp.connected": {
    phoneNumberId: string;
    wabaId: string;
    displayPhoneNumber: string;
  };
  "outreach.whatsapp.disconnected": { phoneNumberId: string; wabaId: string };
  "outreach.message.status_changed": {
    outboundId: string;
    channel: "whatsapp" | "email";
    from: OutboundStatus;
    to: OutboundStatus;
    providerMessageId: string | null;
    providerOccurredAt: string | null;
    contextRef: string | null;
  };
  "outreach.whatsapp.inbound_received": {
    contactId: string;
    inboundId: string;
    providerMessageId: string;
    type: string;
    buttonPayload: string | null;
    contextProviderMessageId: string | null;
    occurredAt: string;
  };
  "outreach.contact.consent_changed": {
    contactId: string;
    channel: "whatsapp" | "email";
    purpose: "marketing" | "transactional";
    action: "grant" | "revoke";
    source: string;
  };
  "outreach.template.status_changed": {
    wabaId: string;
    metaTemplateId: string | null;
    name: string;
    language: string;
    from: string | null;
    to: string;
    category: string;
  };
}

export type OutreachEventInput = {
  [T in OutreachEventType]: {
    tenantId: string;
    type: T;
    eventId: string;
    aggregateId: string;
    occurredAt: Date;
    payload: OutreachEventPayloads[T];
  };
}[OutreachEventType];

/** `tx` is the caller's unit-of-work context: the event is written in the same transaction as the state change. */
export interface OutreachEventSink {
  emit(e: OutreachEventInput, tx?: unknown): Promise<void>;
}

export const OUTREACH_EVENT_TYPES: readonly OutreachEventType[] = [
  "outreach.whatsapp.connected",
  "outreach.whatsapp.disconnected",
  "outreach.message.status_changed",
  "outreach.whatsapp.inbound_received",
  "outreach.contact.consent_changed",
  "outreach.template.status_changed",
];
