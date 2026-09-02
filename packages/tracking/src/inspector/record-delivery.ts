/**
 * Delivery → EventRecord wiring (M6, first milestone).
 *
 * This closes the loop the M5 report flagged: `renderedPayload` and `payloadHash` are load-bearing
 * for replay, but nothing wrote them. Every delivery now produces an immutable record carrying the
 * complete stage history, destination history, retry history, business payload, payload digest,
 * processing versions, and the consent and identity snapshots.
 *
 * The record is built **from what actually happened**, never re-derived from current services —
 * that is the property replay depends on. Everything here is therefore assembled from the envelope
 * and the delivery result that produced it, with no lookups.
 */

import { toBusinessPayload } from "../delivery/transport-envelope";
import type { DeliveryOutcome, DeliveryResult } from "../delivery/delivery-pipeline";
import type { DestinationDefinition, DestinationKey } from "../delivery/destination";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { AttributionSnapshot } from "../pipeline/attribution";
import type { HashPort } from "../ids/dedup-id";
import { computePayloadDigest } from "./payload-integrity";
import {
  currentVersions,
  deriveEventState,
  type DestinationHistoryEntry,
  type DeliveryState,
  type EventRecord,
  type ProcessingVersions,
  type RetryHistoryEntry,
  type StageHistoryEntry,
} from "./event-record";

/** Maps a delivery outcome onto the stored delivery state. */
export function toDeliveryState(outcome: DeliveryOutcome): DeliveryState {
  switch (outcome.status) {
    case "delivered":
      return "delivered";
    case "dead_lettered":
      return "dead_lettered";
    case "blocked":
      return "blocked";
    case "rate_limited":
      return "rate_limited";
    case "circuit_open":
      return "retrying";
    case "skipped_duplicate":
      // A duplicate means the original delivery already succeeded for this destination.
      return "delivered";
  }
}

/** Maps an outcome onto the retry-history entry recorded for the final attempt. */
function toAttemptOutcome(outcome: DeliveryOutcome): RetryHistoryEntry["outcome"] {
  switch (outcome.status) {
    case "delivered":
      return "delivered";
    case "dead_lettered":
      return "permanent_failure";
    case "blocked":
      return "blocked";
    case "rate_limited":
      return "rate_limited";
    case "circuit_open":
      return "circuit_open";
    case "skipped_duplicate":
      return "skipped_duplicate";
  }
}

export interface RecordDeliveryInput {
  readonly envelope: EnrichedEnvelope;
  readonly destination: DestinationDefinition;
  readonly destinationVersion: number;
  readonly mappingKey: string;
  readonly mappingVersion: number;
  /** The payload as rendered for this destination, before transport metadata is added. */
  readonly renderedPayload: Readonly<Record<string, unknown>>;
  readonly result: DeliveryResult;
  readonly at: string;
}

/** Identifies which destination configuration produced a payload. */
export interface PendingEntryInput {
  readonly destination: DestinationDefinition;
  readonly destinationVersion: number;
  readonly mappingKey: string;
  readonly mappingVersion: number;
  readonly renderedPayload: Readonly<Record<string, unknown>>;
}

/**
 * Builds the destination entry as it stands **before any vendor call** — payload and digest
 * present, no attempts yet.
 *
 * This exists because the record must be durable before delivery begins. If the record were only
 * written afterwards, a crash between the vendor accepting an event and the write completing would
 * leave an event that reached a destination with no record that it ever did — unreplayable,
 * unauditable, and invisible. Writing first means the worst case is a record showing `pending`
 * forever, which is a visible anomaly rather than a silent hole.
 */
export async function buildPendingEntry(
  input: PendingEntryInput,
  hasher: HashPort,
): Promise<DestinationHistoryEntry> {
  const business = toBusinessPayload(input.renderedPayload);
  const payloadHash = await computePayloadDigest(business.payload, hasher);

  return {
    destination: input.destination.key,
    destinationVersion: input.destinationVersion,
    mappingKey: input.mappingKey,
    mappingVersion: input.mappingVersion,
    renderedPayload: business.payload,
    payloadHash,
    ...(business.stripped.length === 0 ? {} : { strippedTransportKeys: business.stripped }),
    status: "pending",
    attempts: [],
  };
}

/**
 * Derives the full retry history for one delivery.
 *
 * Intermediate retries are reconstructed as retryable failures: the attempt loop only reaches
 * attempt N by failing attempts 1..N-1, so that history is real and must be visible in the
 * inspector rather than collapsed into a single final outcome.
 */
export function buildRetryHistory(
  result: DeliveryResult,
  at: string,
): readonly RetryHistoryEntry[] {
  const attemptCount =
    result.outcome.status === "delivered" || result.outcome.status === "dead_lettered"
      ? result.outcome.attempts
      : 1;

  const attempts: RetryHistoryEntry[] = [];

  for (let attempt = 1; attempt < attemptCount; attempt += 1) {
    attempts.push({ attempt, at, outcome: "retryable_failure" });
  }

  attempts.push({
    attempt: attemptCount,
    at,
    outcome: toAttemptOutcome(result.outcome),
    ...(result.outcome.status === "delivered" ? { latencyMs: result.outcome.latencyMs } : {}),
    ...(result.outcome.status === "dead_lettered" ? { error: result.outcome.error } : {}),
    ...(result.outcome.status === "blocked"
      ? { error: `${result.outcome.failure.gate}: ${result.outcome.failure.detail}` }
      : {}),
  });

  return attempts;
}

/**
 * Builds the destination history entry for one delivery.
 *
 * The payload is passed through `toBusinessPayload` **before** it is digested, so the digest
 * describes exactly the bytes that will be stored and later replayed. Digesting first and stripping
 * afterwards would produce a hash that never verifies again.
 */
export async function buildDestinationEntry(
  input: RecordDeliveryInput,
  hasher: HashPort,
): Promise<DestinationHistoryEntry> {
  const business = toBusinessPayload(input.renderedPayload);
  const payloadHash = await computePayloadDigest(business.payload, hasher);
  const attempts = buildRetryHistory(input.result, input.at);

  return {
    destination: input.destination.key,
    destinationVersion: input.destinationVersion,
    mappingKey: input.mappingKey,
    mappingVersion: input.mappingVersion,
    renderedPayload: business.payload,
    payloadHash,
    ...(business.stripped.length === 0 ? {} : { strippedTransportKeys: business.stripped }),
    status: toDeliveryState(input.result.outcome),
    attempts,
    firstAttemptAt: input.at,
    lastAttemptAt: input.at,
  };
}

export interface BuildRecordInput {
  readonly envelope: EnrichedEnvelope;
  readonly stageHistory: readonly StageHistoryEntry[];
  readonly destinationEntries: readonly DestinationHistoryEntry[];
  readonly attribution?: AttributionSnapshot;
  readonly identityConfidence?: number;
  readonly ruleSet?: { readonly id: string; readonly version: number };
  readonly versions?: ProcessingVersions;
  readonly at: string;
  /** Destinations the router excluded, recorded so "why did this never leave?" is answerable. */
  readonly exclusions?: readonly {
    readonly destination: DestinationKey;
    readonly reason: string;
  }[];
}

/**
 * Assembles the complete immutable record.
 *
 * Snapshots are taken from the envelope as it was processed — the consent and identity blocks are
 * copied, not looked up — so the record reads identically forever regardless of how the customer's
 * consent or profile later changes.
 */
export function buildEventRecord(input: BuildRecordInput): EventRecord {
  const excluded: DestinationHistoryEntry[] = (input.exclusions ?? []).map((exclusion) => ({
    destination: exclusion.destination,
    destinationVersion: 0,
    mappingKey: "n/a",
    mappingVersion: 0,
    renderedPayload: {},
    status: "excluded" as const,
    attempts: [],
    exclusionReason: exclusion.reason,
  }));

  const destinationHistory = [...input.destinationEntries, ...excluded];
  const identity = input.envelope.context.identity ?? {};

  return {
    eventId: input.envelope.eventId,
    dedupId: input.envelope.dedupId,
    tenantId: input.envelope.tenancy.tenantId,
    eventName: input.envelope.eventName,
    capturedAt: input.envelope.timestamp,
    envelope: input.envelope,

    consentSnapshot: input.envelope.consent,
    identitySnapshot: identity,
    ...(input.attribution === undefined ? {} : { attributionSnapshot: input.attribution }),
    hashStatus: identity.hashStatus,
    ...(input.identityConfidence === undefined
      ? {}
      : { identityConfidence: input.identityConfidence }),

    versions: input.versions ?? currentVersions(input.ruleSet),
    stageHistory: input.stageHistory,
    destinationHistory,

    state: deriveEventState(destinationHistory),
    updatedAt: input.at,
  };
}
