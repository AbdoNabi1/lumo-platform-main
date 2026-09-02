/**
 * The immutable Event Record — a **SYSTEM OF RECORD**, not merely an audit artefact.
 *
 * Because replay re-sends the stored business payload rather than re-deriving it, this record is
 * part of the replay source of truth. Losing it does not degrade observability — it destroys the
 * ability to replay correctly, permanently and silently. It must therefore be operated with the
 * same seriousness as the ledger, not as telemetry.
 *
 * ## Operational guarantees (required, not aspirational)
 *
 * - **Immutable** — a stored record is never edited. Every mutator here returns a new value.
 * - **Append-only** — history grows by appending; a correction is a new entry, never an overwrite.
 * - **Never updated in place** — storage adapters must INSERT, not UPDATE. An adapter that
 *   overwrites a record silently breaks replay determinism for every event it touches.
 * - **Replicated** — durability must not depend on a single node.
 * - **Included in backup/restore** — and restore must be *tested*, since an untested restore is
 *   indistinguishable from no backup until the moment it matters.
 * - **Retained at least as long as the longest replay window** — deleting a record deletes the
 *   ability to replay the event it describes.
 *
 * ## Forensic rules
 *
 * 1. **Nothing is recomputed.** Every snapshot is stored as it was, never re-derived on read.
 * 2. **Nothing is hidden.** Blocked, dropped and dead-lettered outcomes are recorded with the same
 *    fidelity as successes — an event that never left is as forensically important as one that did.
 * 3. **Nothing is mutated.** History grows by appending; a correction is a new entry.
 * 4. **Nothing transport-specific is stored.** The persisted payload is the *business* payload;
 *    credentials, signatures, nonces and request ids are regenerated per transmission and never
 *    written here (see `../delivery/transport-envelope`).
 */

import { EXPRESSION_LANGUAGE_VERSION } from "@platform/expression";

import type { AttributionSnapshot } from "../pipeline/attribution";
import type { ConsentSnapshot } from "../envelope/consent";
import type { IdentityContext } from "../envelope/identity-context";
import type { PipelineStage } from "../pipeline/hashing";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { DestinationKey } from "../delivery/destination";

/** Schema version of the tracking envelope itself. Bumped only on an envelope contract change. */
export const TRACKING_SCHEMA_VERSION = 1;

/** Version of the processing pipeline (stage set and ordering). */
export const PIPELINE_VERSION = 1;

/**
 * Every version used while processing one event, pinned permanently.
 *
 * Without this, a replay six months later would silently apply today's mapping to yesterday's
 * event and produce a different payload — which looks like a successful replay while quietly
 * rewriting history. Pinning is what makes "never silently upgrade historical events" enforceable
 * rather than aspirational.
 */
export interface ProcessingVersions {
  readonly pipelineVersion: number;
  readonly trackingSchemaVersion: number;
  readonly expressionEngineVersion: number;
  readonly ruleSetId?: string;
  readonly ruleSetVersion?: number;
}

/** The versions in effect right now, stamped onto an event at capture. */
export function currentVersions(ruleSet?: { id: string; version: number }): ProcessingVersions {
  return {
    pipelineVersion: PIPELINE_VERSION,
    trackingSchemaVersion: TRACKING_SCHEMA_VERSION,
    expressionEngineVersion: EXPRESSION_LANGUAGE_VERSION,
    ...(ruleSet === undefined ? {} : { ruleSetId: ruleSet.id, ruleSetVersion: ruleSet.version }),
  };
}

/** Outcome of one pipeline stage, recorded as it completed. */
export interface StageHistoryEntry {
  readonly stage: PipelineStage;
  readonly status: "completed" | "skipped" | "failed";
  readonly at: string;
  readonly durationMs?: number;
  /** Why a stage failed or was skipped — never inferred later. */
  readonly detail?: string;
}

/** One delivery attempt against one destination. Append-only. */
export interface RetryHistoryEntry {
  readonly attempt: number;
  readonly at: string;
  readonly outcome:
    | "delivered"
    | "retryable_failure"
    | "permanent_failure"
    | "rate_limited"
    | "circuit_open"
    | "blocked"
    | "skipped_duplicate";
  readonly statusCode?: number;
  readonly error?: string;
  readonly latencyMs?: number;
}

/**
 * Everything about one destination's handling of one event, including the **rendered payload**.
 *
 * Storing the payload is what makes replay genuinely deterministic: a replay re-sends the exact
 * bytes the destination was originally offered, so no mapper, rule engine or enrichment runs again.
 */
export interface DestinationHistoryEntry {
  readonly destination: DestinationKey;
  /** Registry version of the destination definition used. */
  readonly destinationVersion: number;
  readonly mappingKey: string;
  readonly mappingVersion: number;
  /**
   * The immutable **business** payload offered to the vendor, frozen and replayed verbatim.
   *
   * Transport metadata (authorization, signatures, nonces, request ids, request timestamps) is
   * deliberately absent: it is regenerated per transmission. Write this through
   * `toBusinessPayload` so the exclusion is enforced rather than trusted.
   */
  readonly renderedPayload: Readonly<Record<string, unknown>>;
  /**
   * SHA-256 over the **canonical** serialization of `renderedPayload`, written at record time.
   * Replay verifies this before planning or transmitting, so determinism is checkable rather than
   * assumed. See `./payload-integrity`.
   */
  readonly payloadHash?: string;
  /** Transport-metadata paths stripped when the payload was recorded, for transparency. */
  readonly strippedTransportKeys?: readonly string[];
  readonly status: DeliveryState;
  readonly attempts: readonly RetryHistoryEntry[];
  readonly firstAttemptAt?: string;
  readonly lastAttemptAt?: string;
  /** Why this destination was excluded, when it never received an attempt. */
  readonly exclusionReason?: string;
}

export type DeliveryState =
  "pending" | "delivered" | "retrying" | "rate_limited" | "dead_lettered" | "blocked" | "excluded";

/** The overall state of an event across all its destinations. */
export type EventState =
  "captured" | "processing" | "delivered" | "partially_delivered" | "failed" | "blocked";

/**
 * The complete, immutable record. `envelope`, `consent`, `identity` and `attribution` are the
 * snapshots taken during processing — never live lookups, so the record reads identically forever.
 */
export interface EventRecord {
  readonly eventId: string;
  readonly dedupId: string;
  readonly tenantId: string;
  readonly eventName: string;
  readonly capturedAt: string;
  readonly envelope: EnrichedEnvelope;

  readonly consentSnapshot: ConsentSnapshot;
  readonly identitySnapshot: IdentityContext;
  readonly attributionSnapshot?: AttributionSnapshot;
  /** `raw` never appears on a delivered record — the enforcement gate would have blocked it. */
  readonly hashStatus: IdentityContext["hashStatus"];
  readonly identityConfidence?: number;

  readonly versions: ProcessingVersions;
  readonly stageHistory: readonly StageHistoryEntry[];
  readonly destinationHistory: readonly DestinationHistoryEntry[];

  readonly state: EventState;
  readonly updatedAt: string;
}

/**
 * Derives the overall state from destination outcomes.
 *
 * `partially_delivered` is a first-class state rather than being rounded to success or failure:
 * an event that reached Meta but dead-lettered to TikTok is neither, and collapsing it into either
 * hides a real revenue-reporting gap.
 */
export function deriveEventState(history: readonly DestinationHistoryEntry[]): EventState {
  const attempted = history.filter((entry) => entry.status !== "excluded");
  if (attempted.length === 0) {
    return history.length === 0 ? "captured" : "blocked";
  }

  const delivered = attempted.filter((entry) => entry.status === "delivered").length;
  const terminalFailures = attempted.filter(
    (entry) => entry.status === "dead_lettered" || entry.status === "blocked",
  ).length;
  const inFlight = attempted.length - delivered - terminalFailures;

  if (inFlight > 0) return "processing";
  if (delivered === attempted.length) return "delivered";
  if (delivered === 0) return terminalFailures === attempted.length ? "failed" : "processing";
  return "partially_delivered";
}

/** Appends a stage entry, returning a new record. History is never edited in place. */
export function appendStage(record: EventRecord, entry: StageHistoryEntry): EventRecord {
  return {
    ...record,
    stageHistory: [...record.stageHistory, entry],
    updatedAt: entry.at,
  };
}

/**
 * Appends a delivery attempt to a destination's history.
 *
 * A destination absent from the record is added rather than rejected: a late attempt against an
 * unrecorded destination is exactly the kind of anomaly the timeline must preserve, not discard.
 */
export function appendAttempt(
  record: EventRecord,
  destination: DestinationKey,
  attempt: RetryHistoryEntry,
  status: DeliveryState,
): EventRecord {
  const existing = record.destinationHistory.find((entry) => entry.destination === destination);

  const updated: DestinationHistoryEntry =
    existing === undefined
      ? {
          destination,
          destinationVersion: 0,
          mappingKey: "unknown",
          mappingVersion: 0,
          renderedPayload: {},
          status,
          attempts: [attempt],
          firstAttemptAt: attempt.at,
          lastAttemptAt: attempt.at,
        }
      : {
          ...existing,
          status,
          attempts: [...existing.attempts, attempt],
          firstAttemptAt: existing.firstAttemptAt ?? attempt.at,
          lastAttemptAt: attempt.at,
        };

  const history =
    existing === undefined
      ? [...record.destinationHistory, updated]
      : record.destinationHistory.map((entry) =>
          entry.destination === destination ? updated : entry,
        );

  return {
    ...record,
    destinationHistory: history,
    state: deriveEventState(history),
    updatedAt: attempt.at,
  };
}

/** Total attempts across every destination — the `retryCount` the inspector filters on. */
export function totalAttempts(record: EventRecord): number {
  return record.destinationHistory.reduce((sum, entry) => sum + entry.attempts.length, 0);
}

/** Read port for stored records. Tracking defines the contract; persistence is wired outside. */
export interface EventRecordStorePort {
  get(eventId: string): Promise<EventRecord | null>;
  query(filter: EventRecordFilter): Promise<readonly EventRecord[]>;
}

/**
 * Write port. Deliberately **append-only**: there is no `update` method, so a storage adapter
 * cannot be asked to mutate a record in place through this contract. Adapters must INSERT.
 */
export interface EventRecordWriterPort {
  /** Persists a newly captured record. Must reject a duplicate `eventId` rather than overwrite. */
  append(record: EventRecord): Promise<void>;
  /**
   * Appends new history to an existing record. Implementations write a new immutable revision;
   * they must never edit the stored bytes of a prior revision.
   */
  appendHistory(input: {
    readonly eventId: string;
    readonly stages?: readonly StageHistoryEntry[];
    readonly destinations?: readonly DestinationHistoryEntry[];
    readonly state: EventState;
    readonly at: string;
  }): Promise<void>;
}

/** Filters for the inspector and for selecting a replay scope. */
export interface EventRecordFilter {
  readonly tenantId: string;
  readonly from?: string;
  readonly to?: string;
  readonly eventName?: string;
  readonly destination?: DestinationKey;
  readonly deliveryState?: DeliveryState;
  readonly eventState?: EventState;
  readonly consentGranted?: boolean;
  readonly minRetryCount?: number;
  readonly minIdentityConfidence?: number;
  readonly attributionChannel?: string;
  readonly platform?: string;
  readonly customerId?: string;
  readonly orderId?: string;
  readonly failureReason?: string;
  readonly limit?: number;
}
