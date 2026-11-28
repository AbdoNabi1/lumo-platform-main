/**
 * The one way a server-built business envelope (a Purchase, a Delivered, a Cancelled, a Lead) enters the tracking
 * pipeline (Tracking P2-D6): published as `tracking.event.captured.v1` through the Postgres outbox publisher, so it runs
 * through the same ingest consumer as every browser event. Shared by the order consumers
 * (`consumers/tracking-business.consumers.ts`) and the lead emitter (`lead-tracking-emitter.ts`) so the record, the
 * headers and the idempotency rule exist exactly once.
 *
 * Idempotency: the record's `messageId` is the envelope's `eventId`, a UUID derived from tenant + business id
 * (`businessMessageId`, P2-D5). The outbox publisher appends with `skipDuplicates` on it, so publishing the same
 * business event again — a redelivered order message, a sweeper re-send — is the same row, never a second event.
 */

import { topicFor, type EventSerializer } from "@platform/domain-events";
import type { EventPublisher } from "@platform/messaging";
import {
  TRACKING_CAPTURED_TOPIC,
  TRACKING_CAPTURED_VERSION,
  type TrackingCapturedEventPayload,
  type TrackingEnvelope,
} from "@platform/tracking";

/** No address names the store: thrown so the event is retried instead of sent without a source url. */
export class StoreUrlUnavailableError extends Error {
  constructor() {
    super("tracking business: no domain or storefront url names the store");
    this.name = "StoreUrlUnavailableError";
  }
}

export interface PublishTrackingEnvelopeDeps {
  /** The Postgres outbox publisher (P2-D6): idempotent on the record's `messageId`. */
  readonly publisher: Pick<EventPublisher, "publish">;
  readonly serializer: EventSerializer;
}

export interface PublishTrackingEnvelopeInput {
  readonly tenantId: string;
  readonly envelope: TrackingEnvelope;
  /** The producer name stamped on the record (`tracking-business`, `tracking-lead`). */
  readonly producer: string;
  readonly correlationId: string;
  readonly causationId: string;
}

export async function publishTrackingEnvelope(
  deps: PublishTrackingEnvelopeDeps,
  input: PublishTrackingEnvelopeInput,
): Promise<void> {
  const { tenantId, envelope, producer, correlationId, causationId } = input;
  // The envelope's own id is already the UUID derived from the tenant and the business id (P2-D5): the outbox row id
  // and the consumer inbox key. The same business event twice is the same row.
  const messageId = envelope.eventId;
  const payload: TrackingCapturedEventPayload = { envelope };
  const serialized = deps.serializer.serialize({
    messageId,
    type: TRACKING_CAPTURED_TOPIC,
    eventVersion: TRACKING_CAPTURED_VERSION,
    aggregateId: envelope.eventId,
    aggregateType: "tracking_event",
    occurredAt: envelope.timestamp,
    correlationId,
    causationId,
    tenantId,
    producer,
    payload,
    metadata: {},
  });
  await deps.publisher.publish({
    topic: topicFor(TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION),
    // Partitioned by tenant, like every tracking event.
    key: tenantId,
    value: serialized.data,
    headers: {
      messageId,
      type: TRACKING_CAPTURED_TOPIC,
      eventVersion: String(TRACKING_CAPTURED_VERSION),
      contentType: serialized.contentType,
      "content-type": serialized.contentType,
      correlationId,
      causationId,
      tenantId,
      producer,
    },
  });
}
