/**
 * The durable retry queue's port (Tracking P1-D2).
 *
 * `tracking_event_records` is append-only by design — there is no update path — so "this destination
 * still has to be tried again at <time>" cannot live on it. It lives behind this port instead, one
 * entry per (tenant, event, destination). Tracking defines the contract; the runtime app wires a
 * Postgres adapter (`tracking.delivery_retries`) and tests wire a fake.
 *
 * What the queue holds is deliberately thin — ids, a round counter, timestamps and a short error —
 * because everything needed to send again (the rendered payload, the envelope, the consent snapshot)
 * is already in the immutable event record, and re-reading it from there is what guarantees the retry
 * sends the SAME bytes under the SAME `event_id`.
 */

import type { DeliveryOutcome } from "../delivery/delivery-pipeline";
import type { DestinationDefinition, DestinationKey } from "../delivery/destination";
import { planNextRetry, windowExpiresAtMs } from "../delivery/retry-schedule";
import type { EnrichedEnvelope } from "../envelope/envelope";

/** Identifies one parked delivery. */
export interface DeliveryRetryKey {
  readonly tenantId: string;
  readonly eventId: string;
  readonly destination: DestinationKey;
}

export interface DeliveryRetryEntry extends DeliveryRetryKey {
  /** The destination's vendor family (`ga4`, `meta`, …): selects the window. */
  readonly platform: string;
  /** Failed delivery rounds so far; the in-process batch is round 1. Drives the backoff. */
  readonly attempts: number;
  /** The event's own time — the vendor window runs from here. */
  readonly eventTimestamp: Date;
  /** After this instant the vendor no longer takes the event: dead-letter, never send. */
  readonly windowExpiresAt: Date;
  readonly nextRetryAt: Date;
  /** Short error text of the last failure (also kept in the record's attempt list). */
  readonly lastError: string | null;
}

export interface DeliveryRetryQueuePort {
  /**
   * Parks a delivery for retry. Idempotent per key: parking the same (tenant, event, destination)
   * again leaves the existing pending row as it is rather than resetting its schedule.
   */
  schedule(entry: DeliveryRetryEntry, at: Date): Promise<void>;
  /**
   * Takes up to `limit` pending entries due at `now`, oldest first, and LEASES them: each returned
   * entry's `nextRetryAt` is pushed `leaseMs` ahead so a second sweeper (or a crashed one coming back)
   * does not take it too. A lease is not a settlement — an entry whose sweeper died is simply due again.
   */
  claimDue(input: {
    readonly limit: number;
    readonly now: Date;
    readonly leaseMs: number;
  }): Promise<readonly DeliveryRetryEntry[]>;
  markDelivered(key: DeliveryRetryKey, at: Date): Promise<void>;
  reschedule(
    key: DeliveryRetryKey,
    change: {
      readonly attempts: number;
      readonly nextRetryAt: Date;
      readonly lastError: string | null;
    },
    at: Date,
  ): Promise<void>;
  /** Ends the entry for good with a human-readable reason (window closed, permanent refusal, …). */
  markDeadLettered(key: DeliveryRetryKey, reason: string, at: Date): Promise<void>;
}

/** What a delivery outcome means for the durable queue. */
export type RetryDisposition =
  /** Nothing left to do for this destination. */
  | { readonly kind: "done" }
  /** Will never succeed as sent: a gate refused it or the vendor refused it for good. */
  | { readonly kind: "permanent"; readonly reason: string }
  /** May succeed later. `countsAsFailure` is false for a deferral where no vendor call was made. */
  | {
      readonly kind: "transient";
      readonly error: string;
      readonly countsAsFailure: boolean;
      readonly delayMs?: number;
    };

/** How long an open circuit or an empty token bucket is given before the next look. */
const CIRCUIT_RECHECK_MS = 60_000;
const MIN_RATE_LIMIT_WAIT_MS = 5_000;

/**
 * The one place that decides transient versus permanent (the Segment rule the queue research settled
 * on): 5xx, timeouts, 408/429 — the adapter's `retryable` — retry; a 4xx, a missing credential, a
 * revoked token, or any enforcement gate (consent, hashing, mapping…) never will, so it is dead-lettered
 * with its reason instead of being re-sent until the window closes.
 */
export function dispositionOf(outcome: DeliveryOutcome): RetryDisposition {
  switch (outcome.status) {
    case "delivered":
    case "skipped_duplicate":
      return { kind: "done" };
    case "blocked":
      return {
        kind: "permanent",
        reason: `blocked: ${outcome.failure.gate}: ${outcome.failure.detail}`,
      };
    case "dead_lettered":
      return outcome.retryable === true
        ? { kind: "transient", error: outcome.error, countsAsFailure: true }
        : { kind: "permanent", reason: `permanent_refusal: ${outcome.error}` };
    case "circuit_open":
      return {
        kind: "transient",
        error: "circuit_open",
        countsAsFailure: false,
        delayMs: CIRCUIT_RECHECK_MS,
      };
    case "rate_limited":
      return {
        kind: "transient",
        error: "rate_limited",
        countsAsFailure: false,
        delayMs: Math.max(outcome.retryAfterMs, MIN_RATE_LIMIT_WAIT_MS),
      };
  }
}

/** The error text kept on a retry row: short, and already scrubbed of credentials by the adapter. */
const MAX_STORED_ERROR_CHARS = 200;

export function storableError(error: string): string {
  const flat = error.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_STORED_ERROR_CHARS
    ? flat
    : `${flat.slice(0, MAX_STORED_ERROR_CHARS - 1)}…`;
}

/** The event's own time in epoch ms — the instant a vendor window runs from. */
export function eventTimeMs(envelope: EnrichedEnvelope): number {
  const parsed = Date.parse(envelope.timestamp);
  return Number.isFinite(parsed) ? parsed : envelope.eventTimestampMs;
}

export type ParkOutcome =
  /** Recorded for the sweeper; it will be tried again at `at`. */
  | { readonly kind: "parked"; readonly at: Date }
  /** The vendor window leaves no useful moment for another try. */
  | { readonly kind: "window_closed" };

/**
 * Parks a delivery whose first round failed transiently (or was deferred by an open circuit / empty
 * bucket), scheduling its first durable retry. The queue write is idempotent per (tenant, event,
 * destination), so a redelivered ingest message cannot reset the schedule.
 */
export async function parkDelivery(input: {
  readonly queue: DeliveryRetryQueuePort;
  readonly envelope: EnrichedEnvelope;
  readonly destination: DestinationDefinition;
  readonly disposition: Extract<RetryDisposition, { kind: "transient" }>;
  readonly now: Date;
  readonly random?: () => number;
}): Promise<ParkOutcome> {
  const eventMs = eventTimeMs(input.envelope);
  const expiresMs = windowExpiresAtMs(input.destination.platform, eventMs);
  const plan = planNextRetry({
    roundsFailed: 1,
    nowMs: input.now.getTime(),
    windowExpiresAtMs: expiresMs,
    ...(input.disposition.delayMs === undefined ? {} : { delayMs: input.disposition.delayMs }),
    ...(input.random === undefined ? {} : { random: input.random }),
  });
  if (plan.kind === "window_closed") return { kind: "window_closed" };

  const at = new Date(plan.atMs);
  await input.queue.schedule(
    {
      tenantId: input.envelope.tenancy.tenantId,
      eventId: input.envelope.eventId,
      destination: input.destination.key,
      platform: input.destination.platform,
      attempts: 1,
      eventTimestamp: new Date(eventMs),
      windowExpiresAt: new Date(expiresMs),
      nextRetryAt: at,
      lastError: storableError(input.disposition.error),
    },
    input.now,
  );
  return { kind: "parked", at };
}
