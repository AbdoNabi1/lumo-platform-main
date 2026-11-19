import { JsonEventSerializer } from "@platform/domain-events";
import { InMemoryOutboxStore, OutboxWriter } from "@platform/messaging";
import { describe, expect, it } from "vitest";
import {
  OUTREACH_EVENT_TYPES,
  type OutreachEventInput,
  type OutreachEventPayloads,
} from "../application/events";
import { OutboxOutreachEventSink, OutreachEventTranslator } from "./outbox-outreach-event-sink";

const occurredAt = new Date("2026-11-19T10:00:00.000Z");

const PAYLOADS: { [T in keyof OutreachEventPayloads]: OutreachEventPayloads[T] } = {
  "outreach.whatsapp.connected": { phoneNumberId: "p", wabaId: "w", displayPhoneNumber: "+20 1" },
  "outreach.whatsapp.disconnected": { phoneNumberId: "p", wabaId: "w" },
  "outreach.message.status_changed": {
    outboundId: "o1",
    channel: "whatsapp",
    from: "pending",
    to: "accepted",
    providerMessageId: "wamid.1",
    providerOccurredAt: null,
    contextRef: null,
  },
  "outreach.whatsapp.inbound_received": {
    contactId: "c1",
    inboundId: "i1",
    providerMessageId: "wamid.2",
    type: "button",
    buttonPayload: "btn:0",
    contextProviderMessageId: "wamid.1",
    occurredAt: occurredAt.toISOString(),
  },
  "outreach.contact.consent_changed": {
    contactId: "c1",
    channel: "whatsapp",
    purpose: "marketing",
    action: "revoke",
    source: "inbound_keyword",
  },
  "outreach.template.status_changed": {
    wabaId: "w",
    metaTemplateId: "m1",
    name: "t",
    language: "ar",
    from: "PENDING",
    to: "APPROVED",
    category: "UTILITY",
  },
};

function build() {
  const store = new InMemoryOutboxStore();
  const serializer = new JsonEventSerializer();
  const sink = new OutboxOutreachEventSink(
    new OutboxWriter({
      store,
      translator: new OutreachEventTranslator(),
      serializer,
      clock: { now: () => occurredAt },
      producer: "outreach",
    }),
  );
  return { store, serializer, sink };
}

describe("OutboxOutreachEventSink", () => {
  it("writes one envelope per event type: type, .v1 topic, key, tenant, payload (deep-equal)", async () => {
    expect.hasAssertions();
    const { store, serializer, sink } = build();
    for (const type of OUTREACH_EVENT_TYPES) {
      const e = {
        tenantId: "tenant-1",
        type,
        eventId: `evt-${type}`,
        aggregateId: `agg-${type}`,
        occurredAt,
        payload: PAYLOADS[type],
      } as OutreachEventInput;
      await sink.emit(e, {});
    }
    const entries = store.snapshot();
    expect(entries).toHaveLength(OUTREACH_EVENT_TYPES.length);
    for (const [i, type] of OUTREACH_EVENT_TYPES.entries()) {
      const entry = entries[i];
      expect(entry?.topic).toBe(`${type}.v1`);
      expect(entry?.key).toBe(`agg-${type}`);
      expect(entry?.headers.tenantId).toBe("tenant-1");
      expect(entry?.headers.producer).toBe("outreach");
      const envelope = serializer.deserialize<unknown>({
        type,
        eventVersion: 1,
        contentType: entry?.contentType ?? "",
        data: entry?.payload ?? new Uint8Array(),
      });
      expect(envelope).toMatchObject({
        messageId: `evt-${type}`,
        type,
        eventVersion: 1,
        aggregateId: `agg-${type}`,
        tenantId: "tenant-1",
        occurredAt: occurredAt.toISOString(),
        payload: PAYLOADS[type],
      });
    }
  });

  it("requires the caller's transaction context", async () => {
    expect.hasAssertions();
    const { sink } = build();
    await expect(
      sink.emit({
        tenantId: "t",
        type: "outreach.whatsapp.disconnected",
        eventId: "e",
        aggregateId: "a",
        occurredAt,
        payload: PAYLOADS["outreach.whatsapp.disconnected"],
      }),
    ).rejects.toThrow("requires the unit-of-work tx");
  });

  it("the translator ignores foreign events", () => {
    expect.hasAssertions();
    expect(new OutreachEventTranslator().translate({ eventName: "x" })).toBeUndefined();
  });
});
