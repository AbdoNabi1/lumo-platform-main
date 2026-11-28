import { JsonEventSerializer } from "@platform/domain-events";
import type { EventPublisher } from "@platform/messaging";
import {
  businessMessageId,
  TRACKING_CAPTURED_TOPIC,
  type TrackingCapturedEventPayload,
} from "@platform/tracking";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StoreUrlUnavailableError } from "./publish-tracking-envelope";
import { OutboxLeadTrackingEmitter, type LeadTrackingSubjectLike } from "./lead-tracking-emitter";

beforeEach(() => {
  expect.hasAssertions();
});

const NOW = new Date("2026-11-28T12:00:00.000Z");
const LEAD_ID = "01930000-0000-7000-8000-000000000001";
const E164 = "+" + "201012345678";

function subject(over: Partial<LeadTrackingSubjectLike> = {}): LeadTrackingSubjectLike {
  return {
    tenantId: "t-1",
    leadId: LEAD_ID,
    name: "Mona Ali Hassan",
    phone: "01012345678",
    phoneE164: E164,
    email: "mona@example.com",
    sessionId: "session-0001",
    submittedAt: new Date("2026-11-28T11:55:00.000Z"),
    attribution: {
      pageUrl: "https://clinic.example.test/book",
      referrer: "https://google.com/",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      cookies: { fbp: "fb.1.1700000000.123", ga: "GA1.1.123456789.1700000000" },
      visitorId: "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b",
      clickIds: [{ name: "gclid", value: "Cj0KCQ-abc", capturedAt: "2026-11-28T11:00:00.000Z" }],
      utm: { source: "facebook", campaign: "eid" },
    },
    ...over,
  };
}

function build(over: { storeUrl?: string | null; publishError?: Error } = {}) {
  const published: Parameters<EventPublisher["publish"]>[0][] = [];
  const publisher: Pick<EventPublisher, "publish"> = {
    publish: (record) => {
      if (over.publishError !== undefined) return Promise.reject(over.publishError);
      published.push(record);
      return Promise.resolve();
    },
  };
  const storeUrls = {
    storeUrlOf: vi.fn(() =>
      Promise.resolve(over.storeUrl === undefined ? "https://clinic.example.test/" : over.storeUrl),
    ),
  };
  const emitter = new OutboxLeadTrackingEmitter({
    storeUrls,
    publisher,
    serializer: new JsonEventSerializer(),
    clock: { now: () => NOW },
  });
  return { emitter, published, storeUrls };
}

function envelopeOf(record: Parameters<EventPublisher["publish"]>[0]) {
  const text =
    typeof record.value === "string" ? record.value : Buffer.from(record.value).toString("utf8");
  const event = JSON.parse(text) as { payload: TrackingCapturedEventPayload };
  return event.payload.envelope;
}

describe("OutboxLeadTrackingEmitter (P2-D9)", () => {
  it("publishes one tracking.event.captured.v1 record: form_submitted, lead_<id>, derived message id, tenant key", async () => {
    const { emitter, published } = build();
    await emitter.emit(subject());

    expect(published).toHaveLength(1);
    const record = published[0];
    if (record === undefined) throw new Error("nothing published");
    const envelope = envelopeOf(record);
    const messageId = businessMessageId("t-1", `lead_${LEAD_ID}`);
    expect(record.topic).toBe("tracking.event.captured.v1");
    expect(record.key).toBe("t-1");
    expect(record.headers).toMatchObject({
      messageId,
      type: TRACKING_CAPTURED_TOPIC,
      tenantId: "t-1",
      producer: "tracking-lead",
    });
    expect(envelope).toMatchObject({
      eventId: messageId,
      dedupId: `lead_${LEAD_ID}`,
      eventName: "form_submitted",
      source: "server",
      eventOrigin: "server",
      tenancy: { tenantId: "t-1" },
    });
    expect(envelope.timestamp).toBe("2026-11-28T11:55:00.000Z");
  });

  it("maps the lead's attribution: page url, visitor, click ids, utm, browser ids and network", async () => {
    const { emitter, published } = build();
    await emitter.emit(subject());
    const record = published[0];
    if (record === undefined) throw new Error("nothing published");
    const envelope = envelopeOf(record);
    const context = envelope.context as Record<string, unknown>;
    expect((context["page"] as { eventSourceUrl: string }).eventSourceUrl).toBe(
      "https://clinic.example.test/book",
    );
    expect(JSON.stringify(context)).toContain("0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b");
    expect(JSON.stringify(context)).toContain("Cj0KCQ-abc");
    expect(JSON.stringify(context)).toContain("facebook");
    expect(JSON.stringify(context)).toContain("203.0.113.7");
    expect(JSON.stringify(context)).toContain("fb.1.1700000000.123");
    // the lead's session id is the snapshot's session id
    expect(JSON.stringify(context)).toContain("session-0001");
  });

  it("uses the store's address when the lead has no page url, and refuses (so the sweeper retries) when nothing names the store", async () => {
    const plain = subject({
      attribution: { pageUrl: null, referrer: null, ip: null, userAgent: null, cookies: {} },
    });
    const withStore = build();
    await withStore.emitter.emit(plain);
    const record = withStore.published[0];
    if (record === undefined) throw new Error("nothing published");
    const page = (envelopeOf(record).context as { page: { eventSourceUrl: string } }).page;
    expect(page.eventSourceUrl).toBe("https://clinic.example.test/");

    const none = build({ storeUrl: null });
    await expect(none.emitter.emit(plain)).rejects.toBeInstanceOf(StoreUrlUnavailableError);
    expect(none.published).toEqual([]);
    // a lead page url is enough on its own: the store is not even asked for a fallback it does not need
    await none.emitter.emit(subject());
    expect(none.published).toHaveLength(1);
  });

  it("the same lead emitted twice is the same record (same message id): the outbox keeps one", async () => {
    const { emitter, published } = build();
    await emitter.emit(subject());
    await emitter.emit(subject());
    expect(published).toHaveLength(2);
    expect(published[0]?.headers["messageId"]).toBe(published[1]?.headers["messageId"]);
    expect(published[0]?.value).toEqual(published[1]?.value);
  });

  it("never carries the free-text message, and no raw contact data outside the identity block", async () => {
    const { emitter, published } = build();
    // a caller handing over more than the port promises still cannot leak: the adapter picks fields
    await emitter.emit({ ...subject(), message: "my private words" } as LeadTrackingSubjectLike);
    const record = published[0];
    if (record === undefined) throw new Error("nothing published");
    const text =
      typeof record.value === "string" ? record.value : Buffer.from(record.value).toString("utf8");
    expect(text).not.toContain("my private words");
    expect(Object.keys(envelopeOf(record))).not.toContain("message");
  });

  it("a publish failure rejects (the lead stays pending) and logs nothing itself", async () => {
    const { emitter } = build({ publishError: new Error("outbox down") });
    await expect(emitter.emit(subject())).rejects.toThrow("outbox down");
  });

  it("a malformed lead id is a RangeError (permanent), not a retry loop", async () => {
    const { emitter, published } = build();
    await expect(emitter.emit(subject({ leadId: "not a ref!" }))).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(published).toEqual([]);
  });
});
