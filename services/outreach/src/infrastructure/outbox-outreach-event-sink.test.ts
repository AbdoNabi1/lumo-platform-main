import { JsonEventSerializer } from "@platform/domain-events";
import {
  InMemoryOutboxStore,
  type OutboxEntry,
  type OutboxStore,
  OutboxWriter,
} from "@platform/messaging";
import { describe, expect, it } from "vitest";
import {
  OUTREACH_EVENT_TYPES,
  type OutreachEventInput,
  type OutreachEventPayloads,
  type OutreachEventType,
} from "../application/events";
import { TransactionalInMemoryOutboxStore } from "../testing/transactional-in-memory-outbox-store";
import { InMemoryOutreachStore } from "./in-memory-outreach-store";
import { OutboxOutreachEventSink, OutreachEventTranslator } from "./outbox-outreach-event-sink";
import { OUTREACH_PUBLISHED_EVENTS } from "./outreach-event-translator";

const occurredAt = new Date("2026-11-19T10:00:00.000Z");
const writtenAt = new Date("2026-11-19T10:00:05.000Z");

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

/** The aggregate type each event type's envelope names (pinned independently of the translator). */
const AGGREGATE_TYPES: Record<OutreachEventType, string> = {
  "outreach.whatsapp.connected": "whatsapp_connection",
  "outreach.whatsapp.disconnected": "whatsapp_connection",
  "outreach.message.status_changed": "outbound_message",
  "outreach.whatsapp.inbound_received": "inbound_message",
  "outreach.contact.consent_changed": "contact",
  "outreach.template.status_changed": "message_template",
};

function inputFor(type: OutreachEventType, tenantId = "tenant-1"): OutreachEventInput {
  return {
    tenantId,
    type,
    eventId: `evt-${type}`,
    aggregateId: `agg-${type}`,
    occurredAt,
    payload: PAYLOADS[type],
  } as OutreachEventInput;
}

function writerOver<TTx>(store: OutboxStore<TTx>): OutboxWriter<TTx> {
  return new OutboxWriter<TTx>({
    store,
    translator: new OutreachEventTranslator(),
    serializer: new JsonEventSerializer(),
    clock: { now: () => writtenAt },
    producer: "outreach",
  });
}

function build() {
  const store = new InMemoryOutboxStore();
  const serializer = new JsonEventSerializer();
  const sink = new OutboxOutreachEventSink(writerOver(store));
  return { store, serializer, sink };
}

describe("OutboxOutreachEventSink envelopes", () => {
  it.each(OUTREACH_EVENT_TYPES)(
    "%s: the outbox row and the envelope are exactly the canonical ones (deep-equal)",
    async (type) => {
      expect.hasAssertions();
      const { store, serializer, sink } = build();
      await sink.emit(inputFor(type), {});

      const entries = store.snapshot();
      expect(entries).toHaveLength(1);
      const { payload: bytes, ...row } = entries[0] as OutboxEntry;
      expect(row).toStrictEqual({
        id: `evt-${type}`,
        topic: `${type}.v1`,
        key: `agg-${type}`,
        contentType: row.contentType,
        headers: {
          messageId: `evt-${type}`,
          type,
          eventVersion: "1",
          contentType: row.contentType,
          correlationId: `evt-${type}`,
          causationId: `evt-${type}`,
          tenantId: "tenant-1",
          producer: "outreach",
        },
        status: "pending",
        createdAt: writtenAt.toISOString(),
        publishedAt: null,
      });
      const envelope = serializer.deserialize<unknown>({
        type,
        eventVersion: 1,
        contentType: row.contentType,
        data: bytes,
      });
      expect(envelope).toStrictEqual({
        messageId: `evt-${type}`,
        type,
        eventVersion: 1,
        aggregateId: `agg-${type}`,
        aggregateType: AGGREGATE_TYPES[type],
        occurredAt: occurredAt.toISOString(),
        correlationId: `evt-${type}`,
        causationId: `evt-${type}`,
        tenantId: "tenant-1",
        producer: "outreach",
        payload: PAYLOADS[type],
        metadata: {},
      });
    },
  );

  it("the published list is exactly the emitted event types (no extra, no missing, no duplicate)", () => {
    expect.hasAssertions();
    expect([...OUTREACH_PUBLISHED_EVENTS].sort()).toStrictEqual([...OUTREACH_EVENT_TYPES].sort());
    expect(new Set(OUTREACH_PUBLISHED_EVENTS).size).toBe(OUTREACH_PUBLISHED_EVENTS.length);
    expect(Object.keys(AGGREGATE_TYPES).sort()).toStrictEqual(
      [...OUTREACH_PUBLISHED_EVENTS].sort(),
    );
  });

  it("a batch of all six types keeps each event's own tenant and key", async () => {
    expect.hasAssertions();
    const { store, sink } = build();
    for (const type of OUTREACH_EVENT_TYPES) await sink.emit(inputFor(type, `tenant-${type}`), {});
    expect(store.snapshot().map((e) => [e.topic, e.key, e.headers.tenantId])).toStrictEqual(
      OUTREACH_EVENT_TYPES.map((type) => [`${type}.v1`, `agg-${type}`, `tenant-${type}`]),
    );
  });

  it("requires the caller's transaction context", async () => {
    expect.hasAssertions();
    const { store, sink } = build();
    await expect(sink.emit(inputFor("outreach.whatsapp.disconnected"))).rejects.toThrow(
      "requires the unit-of-work tx",
    );
    expect(store.snapshot()).toHaveLength(0);
  });

  it("an event with no tenant is never enqueued (the envelope requires one)", async () => {
    expect.hasAssertions();
    const { store, sink } = build();
    await expect(sink.emit(inputFor("outreach.whatsapp.disconnected", ""), {})).rejects.toThrow(
      "no tenantId",
    );
    expect(store.snapshot()).toHaveLength(0);
  });

  it("the translator ignores foreign events", () => {
    expect.hasAssertions();
    expect(new OutreachEventTranslator().translate({ eventName: "x" })).toBeUndefined();
  });
});

describe("OutboxOutreachEventSink and the caller's transaction", () => {
  it("hands the SAME tx object it was given to the outbox store", async () => {
    expect.hasAssertions();
    const seen: unknown[] = [];
    const spy: OutboxStore<unknown> = {
      append: (_entries, tx) => {
        seen.push(tx);
        return Promise.resolve();
      },
      fetchPending: () => Promise.resolve([]),
      markPublished: () => Promise.resolve(),
    };
    const sink = new OutboxOutreachEventSink(writerOver(spy));
    const tx = { marker: "caller-tx" };
    await sink.emit(inputFor("outreach.contact.consent_changed"), tx);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(tx);
  });

  it("a committed unit of work keeps its outbox rows; a rolled-back one leaves none", async () => {
    expect.hasAssertions();
    const outbox = new TransactionalInMemoryOutboxStore();
    const sink = new OutboxOutreachEventSink(writerOver(outbox));
    const database = new InMemoryOutreachStore();

    await database.transaction("tenant-1", async (tx) => {
      await sink.emit(inputFor("outreach.whatsapp.connected"), tx);
    });
    expect(outbox.snapshot().map((e) => e.topic)).toStrictEqual(["outreach.whatsapp.connected.v1"]);

    await expect(
      database.transaction("tenant-1", async (tx) => {
        await sink.emit(inputFor("outreach.message.status_changed"), tx);
        await sink.emit(inputFor("outreach.contact.consent_changed"), tx);
        expect(outbox.snapshot()).toHaveLength(3);
        throw new Error("the state change failed after the events were written");
      }),
    ).rejects.toThrow("the state change failed");

    // Only the committed transaction's row remains: the rolled-back unit of work left nothing behind.
    expect(outbox.snapshot().map((e) => e.topic)).toStrictEqual(["outreach.whatsapp.connected.v1"]);
    expect(await outbox.fetchPending(10)).toHaveLength(1);
  });

  it("the transactional test outbox refuses an append made without the caller's transaction", async () => {
    expect.hasAssertions();
    const outbox = new TransactionalInMemoryOutboxStore();
    const sink = new OutboxOutreachEventSink(writerOver(outbox));
    await expect(sink.emit(inputFor("outreach.whatsapp.connected"), {})).rejects.toThrow(
      "needs the caller's open transaction",
    );
    expect(outbox.snapshot()).toHaveLength(0);
  });

  it("the transactional test outbox publishes in order and marks rows published", async () => {
    expect.hasAssertions();
    const outbox = new TransactionalInMemoryOutboxStore();
    const sink = new OutboxOutreachEventSink(writerOver(outbox));
    const database = new InMemoryOutreachStore();
    await database.transaction("tenant-1", async (tx) => {
      await sink.emit(inputFor("outreach.whatsapp.connected"), tx);
      await sink.emit(inputFor("outreach.whatsapp.disconnected"), tx);
    });
    const first = await outbox.fetchPending(1);
    expect(first.map((e) => e.id)).toStrictEqual(["evt-outreach.whatsapp.connected"]);
    await outbox.markPublished(
      ["evt-outreach.whatsapp.connected", "unknown"],
      "2026-11-19T11:00:00.000Z",
    );
    expect((await outbox.fetchPending(10)).map((e) => e.id)).toStrictEqual([
      "evt-outreach.whatsapp.disconnected",
    ]);
    expect(outbox.snapshot().map((e) => e.status)).toStrictEqual(["published", "pending"]);
  });
});
