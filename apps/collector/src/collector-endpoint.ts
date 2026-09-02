/**
 * The collector endpoint (P0-1) — transport-neutral.
 *
 * ```
 * Browser → [ this ] → tracking.event.captured.v1 → Tracking Runtime → Pipeline → Router → Delivery
 * ```
 *
 * This module does exactly two things: call `collect()` and publish the result. It runs **no**
 * pipeline stage, and it structurally cannot — `receiveAndDeliver` is internal to the Tracking
 * Runtime (FF-ARCH-09) and this app does not depend on `apps/runtime` at all. The only thing it
 * knows about the pipeline is the topic name, which it imports from `@platform/tracking` so the
 * producer and the consumer share one constant rather than two string literals.
 *
 * It is transport-neutral on purpose. Fastify binding lives in `server.ts`; doc 09 also calls for a
 * Cloudflare Worker beacon, and that adapter should call this same function rather than growing a
 * parallel endpoint. Keeping the HTTP framework out of here is what makes that possible, and is also
 * what lets every branch below be tested without opening a socket.
 */

import type { EventPublisher } from "@platform/messaging";
import type { EventSerializer } from "@platform/domain-events";
import { topicFor } from "@platform/domain-events";
import type { Logger } from "@platform/utils";
import {
  collect,
  PERMANENT_COLLECTOR_REFUSALS,
  TRACKING_CAPTURED_TOPIC,
  TRACKING_CAPTURED_VERSION,
  type CollectorDeps,
  type CollectorRefusal,
  type CollectorRequest,
  type CookieDirective,
  type TrackingCapturedEventPayload,
} from "@platform/tracking";

/** Identifies this producer on the envelope, for tracing and audit. */
const PRODUCER = "tracking-collector";

export interface CollectorEndpointDeps extends CollectorDeps {
  readonly publisher: EventPublisher;
  readonly serializer: EventSerializer;
  readonly logger: Logger;
}

export interface EndpointResponse {
  readonly status: number;
  readonly body: unknown;
  readonly cookies: readonly CookieDirective[];
}

/** Counters so operational validation can assert the collector ran, not infer it from silence. */
export interface CollectorCounters {
  readonly received: number;
  readonly published: number;
  readonly refused: number;
  readonly publishFailed: number;
}

export class CollectorEndpoint {
  private received = 0;
  private published = 0;
  private refused = 0;
  private publishFailed = 0;

  constructor(private readonly deps: CollectorEndpointDeps) {}

  counters(): CollectorCounters {
    return {
      received: this.received,
      published: this.published,
      refused: this.refused,
      publishFailed: this.publishFailed,
    };
  }

  async handle(request: CollectorRequest): Promise<EndpointResponse> {
    this.received += 1;

    const outcome = collect(request, this.deps);

    if (outcome.status === "refused") {
      this.refused += 1;
      return this.refuse(outcome.refusal);
    }

    const { envelope } = outcome;
    const payload: TrackingCapturedEventPayload = { envelope };

    // `messageId` is the envelope's `eventId` — the ingest idempotency key (UUIDv7, unique per
    // occurrence). The runtime consumer dedups on exactly this via `ProcessedEventStore`, so a
    // browser that retries a beacon on a flaky connection is deduplicated end to end rather than
    // producing two records of one occurrence. Minting a fresh id here would defeat that silently.
    const serialized = this.deps.serializer.serialize({
      messageId: envelope.eventId,
      type: TRACKING_CAPTURED_TOPIC,
      eventVersion: TRACKING_CAPTURED_VERSION,
      aggregateId: envelope.eventId,
      aggregateType: "tracking_event",
      occurredAt: envelope.timestamp,
      correlationId: envelope.eventId,
      causationId: envelope.eventId,
      ...(envelope.tenancy?.tenantId === undefined ? {} : { tenantId: envelope.tenancy.tenantId }),
      producer: PRODUCER,
      payload,
      metadata: {},
    });

    try {
      await this.deps.publisher.publish({
        topic: topicFor(TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION),
        // Partitioned by tenant so one merchant's traffic spike cannot reorder another's, while
        // events for a tenant keep per-partition order.
        key: envelope.tenancy?.tenantId ?? envelope.eventId,
        value: serialized.data,
        headers: { "content-type": serialized.contentType },
      });
    } catch (cause) {
      // 503, not 202. Telling the browser "accepted" when the event never reached the bus loses it
      // permanently and invisibly: the SDK would drop its retry, and nothing anywhere would hold a
      // copy. A 5xx lets the beacon retry, and the `eventId` makes that retry idempotent.
      this.publishFailed += 1;
      this.deps.logger.error("collector publish failed", {
        eventId: envelope.eventId,
        tenantId: envelope.tenancy?.tenantId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return {
        status: 503,
        body: {
          code: "PUBLISH_FAILED",
          message: "Event could not be accepted; retry",
          retryable: true,
        },
        // Still set the first-party cookies: the visitor/session ids are valid regardless of whether
        // this particular event reached the bus, and re-minting them on the retry would fragment
        // the session.
        cookies: outcome.cookies,
      };
    }

    this.published += 1;
    return {
      status: 202,
      body: { accepted: true, eventId: envelope.eventId },
      cookies: outcome.cookies,
    };
  }

  /**
   * Refusals answer 400 and are **not** retryable — every collector refusal is permanent by
   * construction (see `PERMANENT_COLLECTOR_REFUSALS`), so a retry would fail identically. The
   * assertion below keeps that claim true: if a transient refusal is ever added, this fails loudly
   * rather than quietly telling a browser to give up on a recoverable event.
   */
  private refuse(refusal: CollectorRefusal): EndpointResponse {
    const permanent = PERMANENT_COLLECTOR_REFUSALS.includes(refusal.code);
    this.deps.logger.warn("collector refused an event", { code: refusal.code, permanent });

    return {
      status: permanent ? 400 : 503,
      body: { code: refusal.code.toUpperCase(), message: describe(refusal), retryable: !permanent },
      cookies: [],
    };
  }
}

/** Renders a refusal as a stable, greppable string. Never echoes request content back verbatim. */
function describe(refusal: CollectorRefusal): string {
  switch (refusal.code) {
    case "malformed_body":
      return `malformed_body: ${refusal.detail}`;
    case "validation_failed":
      return `validation_failed: ${refusal.violations.map((v) => `${v.field} ${v.message}`).join("; ")}`;
    default:
      return refusal.code;
  }
}
