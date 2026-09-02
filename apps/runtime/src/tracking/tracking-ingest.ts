/**
 * Tracking ingest entry point (M6.6.1).
 *
 * This is the thing M6 was missing. `wireTrackingRuntime` built a complete engine and nothing
 * called it; this handler is what production traffic actually arrives through, and it reaches a
 * vendor by exactly one route: `ingestTrackingEvent` → `receiveAndDeliver`.
 *
 * ## Why a bus consumer and not an HTTP route
 *
 * Doc 20 already names `tracking.event.captured` as the bridge between domain events and the
 * clickstream, so subscribing to it adds no new contract — the topic was specified before this
 * milestone. It also gets three properties for free that an HTTP endpoint would have to reinvent:
 * back-pressure (a traffic spike queues instead of shedding), at-least-once redelivery, and the
 * existing Postgres inbox idempotency keyed on `messageId`. A public HTTP collector still has to
 * exist for browser emitters, but it belongs at the edge and its job is to *publish to this topic*,
 * not to call the pipeline itself. Keeping one consumer as the only caller is what makes "no
 * alternate execution path" structural.
 *
 * ## Retry versus dead-letter
 *
 * The consumer runtime dead-letters by exception, after exhausting the retry schedule. That is the
 * right behaviour for a transient fault and the wrong one for a malformed event: a bad envelope is
 * bad forever, so five redeliveries only delay the moment a human sees it. So permanent refusals are
 * dead-lettered here, directly, and the message is acked; only transient refusals throw. This is the
 * same judgement the delivery layer makes when it breaks the attempt loop on a permanent 4xx.
 */

import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import {
  ingestTrackingEvent,
  isPermanentRefusal,
  TRACKING_CAPTURED_TOPIC,
  TRACKING_CAPTURED_VERSION,
  type IngestOutcome,
  type IngestRuntimeDeps,
  type TrackingCapturedEventPayload,
} from "@platform/tracking";

/**
 * The topic contract: `tracking.event.captured.v1`.
 *
 * Re-exported from `@platform/tracking` rather than restated, so the collector that publishes and
 * the consumer that reads are literally the same constants. Two independently-declared copies would
 * compile fine and drift the first time either side changed.
 */
export const TRACKING_CAPTURED_EVENT_TYPE = TRACKING_CAPTURED_TOPIC;
export const TRACKING_CAPTURED_EVENT_VERSION = TRACKING_CAPTURED_VERSION;

/** Payload carried on the bridge topic — the raw envelope, unprocessed. */
export type TrackingCapturedPayload = TrackingCapturedEventPayload;

/** Minimal dead-letter sink, matching `@platform/messaging`'s store contract. */
export interface IngestDeadLetterPort {
  add(entry: {
    messageId: string;
    topic: string;
    value: Uint8Array;
    headers: Readonly<Record<string, string>>;
    attempts: number;
    error: string;
    failedAt: string;
  }): Promise<void>;
}

/** Counters the module exposes for operational validation (M6.6.6). */
export interface IngestCounters {
  readonly received: number;
  readonly accepted: number;
  readonly refused: number;
  readonly deadLettered: number;
  readonly deliveredTargets: number;
}

export class TrackingIngestHandler implements EventHandler<TrackingCapturedPayload> {
  readonly eventType = TRACKING_CAPTURED_EVENT_TYPE;
  readonly eventVersion = TRACKING_CAPTURED_EVENT_VERSION;

  private received = 0;
  private accepted = 0;
  private refused = 0;
  private deadLettered = 0;
  private deliveredTargets = 0;

  constructor(
    private readonly deps: {
      /**
       * Resolves the ingest dependencies for **one** event.
       *
       * A provider rather than a fixed object because the registry is hot-reloadable (M6.7): each
       * call pins the snapshot current at that moment, and this handler calls it exactly once per
       * event, so a reload landing mid-event cannot change the definitions under it. Holding a
       * single object here instead would either freeze the consumer on the registry it booted with
       * — the restart-required behaviour the reload exists to remove — or, if that object read the
       * handle internally, expose the event to a mid-pipeline swap.
       */
      readonly ingest: () => IngestRuntimeDeps;
      readonly deadLetters: IngestDeadLetterPort;
      readonly logger: Logger;
      readonly clock: { now(): Date };
    },
  ) {}

  /**
   * Snapshot of what this consumer has actually done.
   *
   * Exposed so operational validation can assert the runtime executed rather than inferring it from
   * the absence of errors. A counter that never moves is the signal that ingest is wired but dead —
   * which is precisely the condition M6 shipped in and nothing detected.
   */
  counters(): IngestCounters {
    return {
      received: this.received,
      accepted: this.accepted,
      refused: this.refused,
      deadLettered: this.deadLettered,
      deliveredTargets: this.deliveredTargets,
    };
  }

  async handle(event: IntegrationEvent<TrackingCapturedPayload>): Promise<void> {
    this.received += 1;

    // Pinned once, here, for the whole event.
    const outcome = await ingestTrackingEvent(this.deps.ingest(), {
      envelope: event.payload.envelope,
    });

    if (outcome.status === "accepted") {
      this.accepted += 1;
      this.deliveredTargets += outcome.delivery.results.filter(
        (result) => result.result.outcome.status === "delivered",
      ).length;
      this.deps.logger.info("tracking event ingested", {
        eventId: outcome.delivery.record.eventId,
        tenantId: outcome.delivery.record.tenantId,
        state: outcome.delivery.record.state,
        routed: outcome.routing.routed.length,
        excluded: outcome.routing.excluded.length,
        renderFailures: outcome.delivery.renderFailures.length,
      });
      return;
    }

    this.refused += 1;
    await this.refuse(event, outcome);
  }

  private async refuse(
    event: IntegrationEvent<TrackingCapturedPayload>,
    outcome: Extract<IngestOutcome, { status: "refused" }>,
  ): Promise<void> {
    const reason = describe(outcome.refusal);

    if (!isPermanentRefusal(outcome.refusal)) {
      // Transient: the event is valid and will succeed once the registry is reachable. Throwing
      // hands it back to the consumer runtime's retry schedule rather than discarding real revenue.
      this.deps.logger.warn("tracking ingest deferred", { messageId: event.messageId, reason });
      throw new Error(`tracking ingest deferred: ${reason}`);
    }

    this.deadLettered += 1;
    await this.deps.deadLetters.add({
      messageId: event.messageId,
      topic: `${this.eventType}.v${String(this.eventVersion)}`,
      // The envelope is preserved verbatim so the dead letter is diagnosable and, once the cause is
      // fixed, republishable. A dead letter that records only the reason cannot be recovered from.
      value: new TextEncoder().encode(JSON.stringify(event.payload)),
      headers: { type: event.type, eventVersion: String(event.eventVersion) },
      attempts: 1,
      error: reason,
      failedAt: this.deps.clock.now().toISOString(),
    });

    this.deps.logger.warn("tracking event refused", { messageId: event.messageId, reason });
  }
}

/** Renders a refusal as a stable, greppable string. */
function describe(refusal: Extract<IngestOutcome, { status: "refused" }>["refusal"]): string {
  switch (refusal.code) {
    case "validation_failed":
      return `validation_failed: ${refusal.violations.map((v) => `${v.field} ${v.message}`).join("; ")}`;
    case "non_production_event":
      return `non_production_event: environment=${refusal.environment}`;
    case "rule_set_unavailable":
      return `rule_set_unavailable: ${refusal.ruleSetKey}`;
    default:
      return refusal.code;
  }
}
