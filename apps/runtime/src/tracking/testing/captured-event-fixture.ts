import type { Clock } from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import type { OutboxEntry, PublishRecord } from "@platform/messaging";
import { collect, TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION } from "@platform/tracking";
import type { TrackingCapturedPayload } from "../tracking-ingest";

export const FIXTURE_NOW = new Date("2026-11-27T12:00:00.000Z");
const clock: Clock = { now: () => FIXTURE_NOW };

/** The record the capture route would hand its sink, built with the same calls the route makes. */
export function routeRecord(tenantId: string, eventId: string, messageId: string): PublishRecord {
  const outcome = collect(
    {
      body: {
        writeKey: tenantId,
        event: {
          eventId,
          eventName: "page_view",
          eventVersion: 1,
          timestamp: FIXTURE_NOW.toISOString(),
          environment: "production",
          consent: { analytics: true, marketing: false, personalization: false },
          properties: {},
        },
      },
      headers: () => undefined,
      cookies: () => undefined,
      remoteAddress: "203.0.113.7",
    },
    {
      writeKeys: { resolve: (key) => (key === tenantId ? { tenantId } : null) },
      idGenerator: { generate: () => "0192f0aa-0000-7000-8000-00000000f001" },
      clock,
      ipPolicy: { trustedProxyCount: 0 },
    },
  );
  if (outcome.status !== "accepted") throw new Error("fixture event must be accepted");
  const serialized = new JsonEventSerializer().serialize({
    messageId,
    type: TRACKING_CAPTURED_TOPIC,
    eventVersion: TRACKING_CAPTURED_VERSION,
    aggregateId: eventId,
    aggregateType: "tracking_event",
    occurredAt: FIXTURE_NOW.toISOString(),
    correlationId: eventId,
    causationId: eventId,
    tenantId,
    producer: "tracking-edge",
    payload: { envelope: outcome.envelope } satisfies TrackingCapturedPayload,
    metadata: {},
  });
  return {
    topic: "tracking.event.captured.v1",
    key: tenantId,
    value: serialized.data,
    headers: {
      messageId,
      type: TRACKING_CAPTURED_TOPIC,
      eventVersion: String(TRACKING_CAPTURED_VERSION),
      contentType: serialized.contentType,
      tenantId,
    },
  };
}

export function toEntry(record: PublishRecord): OutboxEntry {
  return {
    id: record.headers["messageId"] ?? "",
    topic: record.topic,
    key: record.key,
    contentType: record.headers["contentType"] ?? "",
    payload: record.value,
    headers: record.headers,
    status: "pending",
    createdAt: FIXTURE_NOW.toISOString(),
    publishedAt: null,
  };
}
