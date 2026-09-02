/**
 * Recording delivery runtime (M6.1, M6.3).
 *
 * M5 built the immutable `EventRecord` and a replay engine that reads it, but nothing in the
 * delivery path ever wrote one — replay was correct against contracts and empty against production.
 * This module closes that gap: it is the single path by which an event reaches a vendor, and it
 * cannot reach one without leaving a record behind.
 *
 * ## The ordering that matters
 *
 * ```
 * receive → normalize → map → business payload → payload hash → APPEND RECORD → deliver
 *         → append delivery result → append retry history → append final status
 * ```
 *
 * The record is appended **before** the first vendor call, not after. If it were written
 * afterwards, a crash between the vendor accepting an event and the write landing would leave an
 * event that really was delivered with no record that it ever existed: unreplayable, unauditable,
 * and — worst of all — invisible, because nothing would remain to indicate anything was missing.
 * Writing first inverts the failure mode into a record stuck at `pending`, which is a *visible*
 * anomaly an operator can find and reconcile.
 *
 * ## Why mapping moved out of `deliver`
 *
 * The payload must exist before the record is appended, and the recorded bytes must be the
 * transmitted bytes. So the Map phase runs here via `renderPayload`, and the result is handed to
 * `deliver` rather than re-derived inside it. Re-mapping at transmission time would allow the
 * stored payload and the sent payload to diverge — the record would then describe an event that
 * never happened, which is worse than no record at all.
 *
 * ## Append-only
 *
 * Nothing here updates. The initial state is written with `append`; every subsequent fact is added
 * with `appendHistory`. `EventRecordWriterPort` has no `update` method, so this is structural
 * rather than a convention this module happens to follow.
 */

import {
  deliver,
  renderPayload,
  type DeliveryDeps,
  type DeliveryResult,
} from "../delivery/delivery-pipeline";
import type { DestinationDefinition, DestinationKey } from "../delivery/destination";
import { toRoutingContext } from "../delivery/destination";
import type { RoutingDecision } from "../delivery/router";
import {
  INITIAL_CIRCUIT,
  initialRateLimit,
  type CircuitState,
  type RateLimitState,
} from "../delivery/resilience";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { IdentityContext } from "../envelope/identity-context";
import type { HashPort } from "../ids/dedup-id";
import { hashIdentity } from "../pipeline/hashing";
import { normalizeIdentity } from "../pipeline/normalization";
import type { AttributionSnapshot } from "../pipeline/attribution";
import {
  buildEventRecord,
  buildPendingEntry,
  buildRetryHistory,
  toDeliveryState,
} from "../inspector/record-delivery";
import {
  currentVersions,
  deriveEventState,
  type DestinationHistoryEntry,
  type EventRecord,
  type EventRecordWriterPort,
  type ProcessingVersions,
  type StageHistoryEntry,
} from "../inspector/event-record";

/**
 * The runtime's phases, exported as data so the order is asserted by tests rather than only
 * described here. A phase inserted between `payload_hash` and `append_record` — or worse, after
 * `deliver` — would break the "no event leaves without a record" guarantee, and the test catches it.
 */
export const DELIVERY_PHASES = [
  "receive",
  "normalize",
  "map",
  "business_payload",
  "payload_hash",
  "append_record",
  "deliver",
  "append_delivery_result",
  "append_retry_history",
  "append_final_status",
] as const;

export type DeliveryPhase = (typeof DELIVERY_PHASES)[number];

/**
 * Resolves the registry versions in force for a destination and mapping profile.
 *
 * Pinned onto the record so a replay six months later can prove which configuration produced the
 * stored bytes. Mandatory: a record with unknown provenance cannot support a forensic replay, and
 * defaulting the versions to zero would fabricate provenance rather than admit its absence.
 */
export interface VersionResolverPort {
  destinationVersion(key: DestinationKey): number;
  mappingVersion(mappingProfileKey: string): number;
  /** The routing rule set in force, when one is configured. */
  ruleSet(): { readonly id: string; readonly version: number } | null;
}

/**
 * Per-destination circuit-breaker and rate-limiter state.
 *
 * This is genuine runtime state, not a test seam: `deliver` is a pure state transition that takes
 * the current state and returns the next, so something must hold it between events. Held per
 * process — see {@link InMemoryDestinationState} for the scaling consequence.
 */
export interface DestinationRuntimeState {
  readonly circuit: CircuitState;
  readonly rateLimit: RateLimitState;
}

export interface DestinationStatePort {
  /**
   * Current state for a destination, seeded on first use. The definition is required because a
   * token bucket cannot be seeded without knowing its burst size — seeding it empty would rate-limit
   * the first event against every freshly registered destination.
   */
  get(destination: DestinationDefinition, nowMs: number): DestinationRuntimeState;
  set(key: DestinationKey, state: DestinationRuntimeState): void;
}

/**
 * Process-local destination state.
 *
 * **Known limitation, recorded rather than hidden:** the token bucket and circuit breaker are
 * per-process, so N horizontally scaled delivery workers will over-send by up to a factor of N
 * against a vendor quota, and each worker trips its breaker independently. Correcting this needs a
 * shared bucket (Redis) behind this same port — the port exists so that change is a wiring change,
 * not a rewrite.
 */
export class InMemoryDestinationState implements DestinationStatePort {
  private readonly state = new Map<DestinationKey, DestinationRuntimeState>();

  get(destination: DestinationDefinition, nowMs: number): DestinationRuntimeState {
    const existing = this.state.get(destination.key);
    if (existing !== undefined) return existing;

    return {
      circuit: INITIAL_CIRCUIT,
      // A destination with no rate-limit descriptor never consults this bucket, so the seed value
      // is inert rather than restrictive.
      rateLimit:
        destination.rateLimit === undefined
          ? { tokens: 0, lastRefillMs: nowMs }
          : initialRateLimit(destination.rateLimit, nowMs),
    };
  }

  set(key: DestinationKey, state: DestinationRuntimeState): void {
    this.state.set(key, state);
  }
}

/** Every collaborator the runtime needs. All mandatory — see the module note in `wire`. */
export interface RecordingRuntimeDeps {
  readonly delivery: DeliveryDeps;
  readonly records: EventRecordWriterPort;
  readonly hasher: HashPort;
  readonly versions: VersionResolverPort;
  readonly destinationState: DestinationStatePort;
  readonly clock: { now(): Date };
  /** Default country used to normalize a national phone number. Omitted ⇒ such numbers are dropped. */
  readonly defaultCountryCode?: string;
}

export interface ReceiveEventInput {
  readonly envelope: EnrichedEnvelope;
  /** The routing decision, produced by `route()` before the event enters this runtime. */
  readonly routing: RoutingDecision;
  readonly attribution?: AttributionSnapshot;
  readonly identityConfidence?: number;
}

export interface ReceiveEventOutput {
  /** The record as finally persisted — the same value a subsequent read must return. */
  readonly record: EventRecord;
  readonly results: readonly {
    readonly destination: DestinationKey;
    readonly result: DeliveryResult;
  }[];
  /** Destinations whose payload could not be rendered, so they were never attempted. */
  readonly renderFailures: readonly {
    readonly destination: DestinationKey;
    readonly detail: string;
  }[];
}

function stage(
  name: StageHistoryEntry["stage"],
  at: string,
  status: StageHistoryEntry["status"] = "completed",
  detail?: string,
): StageHistoryEntry {
  return { stage: name, status, at, ...(detail === undefined ? {} : { detail }) };
}

/**
 * Normalizes and hashes the identity block.
 *
 * Normalization must precede hashing — hashing a dirty value destroys every chance of a match and
 * the damage is undetectable downstream, since a hash of `" Bob@Example.com "` is a perfectly
 * well-formed hash of the wrong thing. An already-hashed block is passed through untouched rather
 * than re-hashed; `hashIdentity` would throw `DoubleHashError`, and catching that to continue would
 * be indistinguishable from not checking at all.
 */
async function prepareIdentity(
  identity: IdentityContext,
  hasher: HashPort,
  defaultCountryCode?: string,
): Promise<IdentityContext> {
  if (identity.hashStatus !== "raw") return identity;

  const normalized = normalizeIdentity(
    identity,
    defaultCountryCode === undefined ? {} : { defaultCountryCode },
  );
  return hashIdentity(normalized, hasher);
}

/**
 * Runs one event through the full recording pipeline.
 *
 * Returns the persisted record. Throws only if the record store itself fails: a store that cannot
 * accept the record must stop delivery, because proceeding would transmit an event we have already
 * established we cannot account for.
 */
export async function receiveAndDeliver(
  deps: RecordingRuntimeDeps,
  input: ReceiveEventInput,
): Promise<ReceiveEventOutput> {
  const at = deps.clock.now().toISOString();
  const stages: StageHistoryEntry[] = [stage("capture", at)];

  // --- Phase: normalize (+ PII hashing, which must happen before mapping) ---
  const rawIdentity = input.envelope.context.identity;
  let envelope = input.envelope;

  if (rawIdentity !== undefined) {
    const identity = await prepareIdentity(rawIdentity, deps.hasher, deps.defaultCountryCode);
    envelope = {
      ...input.envelope,
      context: { ...input.envelope.context, identity },
    };
    stages.push(stage("normalize", at));
    stages.push(
      stage(
        "pii_hashing",
        at,
        identity.hashStatus === "sha256" ? "completed" : "skipped",
        `hashStatus=${identity.hashStatus ?? "unset"}`,
      ),
    );
  } else {
    stages.push(stage("normalize", at, "skipped", "no identity block"));
  }

  stages.push(stage("destination_routing", at, input.routing.degraded ? "failed" : "completed"));

  // --- Phases: map → business payload → payload hash ---
  const routingContext = toRoutingContext(envelope);
  const pending: DestinationHistoryEntry[] = [];
  const prepared: {
    destination: DestinationDefinition;
    payload: Readonly<Record<string, unknown>>;
  }[] = [];
  const renderFailures: { destination: DestinationKey; detail: string }[] = [];

  for (const routed of input.routing.routed) {
    const rendered = renderPayload(deps.delivery, routed.destination, routingContext);

    if (!rendered.ok) {
      // A destination whose payload cannot be built is recorded as blocked, not dropped silently.
      renderFailures.push({ destination: routed.destination.key, detail: rendered.failure.detail });
      pending.push({
        destination: routed.destination.key,
        destinationVersion: deps.versions.destinationVersion(routed.destination.key),
        mappingKey: routed.destination.mappingProfileKey,
        mappingVersion: deps.versions.mappingVersion(routed.destination.mappingProfileKey),
        renderedPayload: {},
        status: "blocked",
        attempts: [
          {
            attempt: 1,
            at,
            outcome: "blocked",
            error: `${rendered.failure.gate}: ${rendered.failure.detail}`,
          },
        ],
        firstAttemptAt: at,
        lastAttemptAt: at,
      });
      continue;
    }

    // `buildPendingEntry` strips transport metadata and digests the result, in that order.
    const entry = await buildPendingEntry(
      {
        destination: routed.destination,
        destinationVersion: deps.versions.destinationVersion(routed.destination.key),
        mappingKey: routed.destination.mappingProfileKey,
        mappingVersion: deps.versions.mappingVersion(routed.destination.mappingProfileKey),
        renderedPayload: rendered.payload,
      },
      deps.hasher,
    );

    pending.push(entry);
    // The *stored* payload is what gets transmitted — not `rendered.payload`. They differ whenever
    // the mapper emitted a transport key, and transmitting the unstripped version would send bytes
    // whose digest does not match the record.
    prepared.push({ destination: routed.destination, payload: entry.renderedPayload });
  }

  stages.push(stage("platform_mapping", at, renderFailures.length === 0 ? "completed" : "failed"));
  stages.push(stage("destination_formatting", at));

  const ruleSet = deps.versions.ruleSet();
  const versions: ProcessingVersions = currentVersions(ruleSet ?? undefined);

  // --- Phase: append record (BEFORE any vendor call) ---
  const initial = buildEventRecord({
    envelope,
    stageHistory: stages,
    destinationEntries: pending,
    versions,
    at,
    ...(input.attribution === undefined ? {} : { attribution: input.attribution }),
    ...(input.identityConfidence === undefined
      ? {}
      : { identityConfidence: input.identityConfidence }),
    exclusions: input.routing.excluded.map((excluded) => ({
      destination: excluded.key,
      reason: excluded.reason.code,
    })),
  });

  await deps.records.append(initial);

  // --- Phase: deliver ---
  const results: { destination: DestinationKey; result: DeliveryResult }[] = [];
  const finalEntries: DestinationHistoryEntry[] = [];

  for (const { destination, payload } of prepared) {
    const state = deps.destinationState.get(destination, deps.clock.now().getTime());

    const result = await deliver(deps.delivery, {
      envelope,
      destination,
      routingContext,
      circuit: state.circuit,
      rateLimit: state.rateLimit,
      renderedPayload: payload,
    });

    deps.destinationState.set(destination.key, {
      circuit: result.circuit,
      rateLimit: result.rateLimit,
    });
    results.push({ destination: destination.key, result });

    // --- Phases: append delivery result + retry history ---
    const completedAt = deps.clock.now().toISOString();
    const pendingEntry = pending.find((entry) => entry.destination === destination.key);

    finalEntries.push({
      ...(pendingEntry ?? {
        destination: destination.key,
        destinationVersion: deps.versions.destinationVersion(destination.key),
        mappingKey: destination.mappingProfileKey,
        mappingVersion: deps.versions.mappingVersion(destination.mappingProfileKey),
        renderedPayload: payload,
      }),
      status: toDeliveryState(result.outcome),
      attempts: buildRetryHistory(result, completedAt),
      firstAttemptAt: at,
      lastAttemptAt: completedAt,
    });
  }

  // --- Phase: append final status ---
  const finishedAt = deps.clock.now().toISOString();
  const blockedEntries = pending.filter((entry) => entry.status === "blocked");
  const excludedEntries = initial.destinationHistory.filter((entry) => entry.status === "excluded");
  const history = [...finalEntries, ...blockedEntries, ...excludedEntries];
  const state = deriveEventState(history);

  const deliveryStage = stage(
    "delivery",
    finishedAt,
    results.some((r) => r.result.outcome.status === "delivered") ? "completed" : "failed",
  );
  const retryStage = stage(
    "retry",
    finishedAt,
    results.some((r) => r.result.outcome.status === "dead_lettered") ? "failed" : "completed",
  );

  await deps.records.appendHistory({
    eventId: initial.eventId,
    stages: [deliveryStage, retryStage],
    destinations: finalEntries,
    state,
    at: finishedAt,
  });

  return {
    record: {
      ...initial,
      stageHistory: [...stages, deliveryStage, retryStage],
      destinationHistory: history,
      state,
      updatedAt: finishedAt,
    },
    results,
    renderFailures,
  };
}
