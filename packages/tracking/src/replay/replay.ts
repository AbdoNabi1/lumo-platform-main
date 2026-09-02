/**
 * Replay Engine (directive §1, §Replay Engine).
 *
 * ## The determinism guarantee
 *
 * Replay **never rebuilds an event**. It does not normalize, validate, enrich, stitch identity,
 * resolve consent, attribute, hash, evaluate rules or run any mapper. It starts at destination
 * routing and proceeds only through delivery and retry:
 *
 * ```
 * stored record → destination routing → delivery → retry
 * ```
 *
 * Two consequences make this literally true rather than approximately true:
 *
 * 1. **Targets come from stored destination history, not from rule evaluation.** Re-running the
 *    rule set would apply today's routing rules to yesterday's event — the exact silent rewrite of
 *    history the directive forbids.
 * 2. **Payloads come from the stored `renderedPayload`, not from a mapper.** Re-mapping, even with
 *    a pinned version, would depend on the enrichment and identity state at replay time. Re-sending
 *    the frozen bytes the vendor was originally offered is the only construction with no
 *    recomputation anywhere in it.
 *
 * The pinned `ProcessingVersions` on the record therefore serve as **forensic provenance** — proof
 * of what produced these bytes — rather than as inputs to be re-executed. A replay whose record
 * lacks a rendered payload is refused, not reconstructed.
 */

import type { DestinationKey, DestinationDefinition } from "../delivery/destination";
import type {
  DestinationHistoryEntry,
  EventRecord,
  EventRecordFilter,
} from "../inspector/event-record";
import { verifyPayloadDigest } from "../inspector/payload-integrity";
import type { HashPort } from "../ids/dedup-id";

/**
 * What a replay is allowed to target.
 *
 * `filter` covers replay by destination, by time range and of failed deliveries — those are
 * `EventRecordFilter` fields, not separate scope kinds, so they compose (failed Meta deliveries
 * from Tuesday is one filter, not three special cases).
 */
export type ReplayScope =
  | { readonly kind: "single"; readonly eventId: string }
  /** An explicit set of event ids — the operator-curated recovery list. */
  | { readonly kind: "batch"; readonly eventIds: readonly string[] }
  | { readonly kind: "filter"; readonly filter: EventRecordFilter }
  | { readonly kind: "dead_letter"; readonly filter: EventRecordFilter };

export type ReplayStatus = "preview" | "running" | "completed" | "cancelled" | "failed";

/**
 * Why a specific event could not be replayed. Refusals are explicit, never silent skips — and
 * critically, **never a substitution**: replay will not fall back to another destination, a newer
 * configuration version, or a different credential. Historical routing is immutable, so a
 * destination whose configuration has gone is a failure to be surfaced, not a gap to be papered
 * over. Silently retargeting would send a customer's conversion data somewhere they never
 * consented to and no audit trail would show it.
 */
export type ReplayRefusal =
  | { readonly code: "no_rendered_payload"; readonly destination: DestinationKey }
  /**
   * The stored payload does not match its stored digest — corruption, accidental mutation, a bad
   * restore, or a serialization regression. Replay refuses rather than transmitting bytes it
   * cannot vouch for.
   */
  | {
      readonly code: "payload_corrupted";
      readonly destination: DestinationKey;
      readonly reason: "digest_mismatch" | "digest_absent" | "not_canonicalizable";
    }
  /** The destination is no longer registered at all — deleted, or its integration removed. */
  | { readonly code: "destination_missing"; readonly destination: DestinationKey }
  /** The destination exists, but the exact historical version is gone — config was replaced. */
  | {
      readonly code: "configuration_removed";
      readonly destination: DestinationKey;
      readonly historicalVersion: number;
    }
  /** Credentials revoked, rotated away, or the workspace disconnected. */
  | { readonly code: "credentials_unavailable"; readonly destination: DestinationKey }
  | { readonly code: "destination_disabled"; readonly destination: DestinationKey }
  | { readonly code: "no_eligible_destinations" }
  | { readonly code: "never_consented" };

/** Refusal codes that indicate a destination-lifecycle problem an operator must resolve. */
export const DESTINATION_LIFECYCLE_REFUSALS: readonly ReplayRefusal["code"][] = [
  "destination_missing",
  "configuration_removed",
  "credentials_unavailable",
  "destination_disabled",
];

/** One event/destination pair a replay would re-send. */
export interface ReplayTarget {
  readonly eventId: string;
  readonly destination: DestinationKey;
  /** The frozen payload — re-sent verbatim, never re-derived. */
  readonly renderedPayload: Readonly<Record<string, unknown>>;
  /** Versions that originally produced this payload, carried for audit. */
  readonly mappingKey: string;
  readonly mappingVersion: number;
  readonly destinationVersion: number;
  readonly dedupId: string;
  /** Digest the payload was verified against, re-checked immediately before transmission. */
  readonly payloadHash?: string;
}

export interface ReplayPlan {
  readonly replayId: string;
  readonly scope: ReplayScope;
  readonly targets: readonly ReplayTarget[];
  readonly refusals: readonly { readonly eventId: string; readonly refusal: ReplayRefusal }[];
  readonly eventCount: number;
  readonly targetCount: number;
}

export interface ReplayRequest {
  readonly replayId: string;
  readonly scope: ReplayScope;
  /** Restrict to specific destinations; omitted replays every destination in history. */
  readonly destinations?: readonly DestinationKey[];
  /** Restrict to attempts that failed with a matching reason. */
  readonly failureReason?: string;
  readonly requestedBy: string;
  readonly reason: string;
  readonly dryRun: boolean;
}

/**
 * Which destination entries of a record are replayable.
 *
 * Consent is re-checked against the **stored snapshot**, never against current consent. Replaying
 * an event that was captured without marketing consent would forward data the visitor never
 * permitted; and conversely, a later grant does not retroactively license an earlier event.
 */
export function eligibleEntries(
  record: EventRecord,
  request: Pick<ReplayRequest, "destinations" | "failureReason" | "scope">,
): readonly DestinationHistoryEntry[] {
  return record.destinationHistory.filter((entry) => {
    if (request.destinations !== undefined && !request.destinations.includes(entry.destination)) {
      return false;
    }

    if (request.scope.kind === "dead_letter" && entry.status !== "dead_lettered") return false;

    if (request.failureReason !== undefined) {
      const matched = entry.attempts.some(
        (attempt) => attempt.error?.includes(request.failureReason ?? "") === true,
      );
      if (!matched) return false;
    }

    // An excluded destination was never offered the event; replaying it would deliver something
    // that was correctly withheld the first time.
    return entry.status !== "excluded";
  });
}

export interface PlanDeps {
  /** Resolves the destination as it exists now, to confirm it can still receive traffic. */
  readonly destinations: {
    resolve(key: DestinationKey): DestinationDefinition | null;
    /**
     * Resolves the exact historical version. Supplied so replay can detect that the configuration
     * it originally used has been replaced, rather than quietly using today's.
     */
    resolveVersion?(key: DestinationKey, version: number): DestinationDefinition | null;
  };
  /**
   * Confirms a credential reference still resolves. Checked at plan time so a revoked credential
   * surfaces in the dry run rather than as a wave of delivery failures.
   */
  readonly credentials?: {
    isAvailable(ref: string): boolean;
  };
}

/**
 * Builds a replay plan. This is the dry-run: identical work to a live replay minus the transport,
 * so a preview is a truthful rehearsal rather than an estimate.
 */
export function planReplay(
  deps: PlanDeps,
  request: ReplayRequest,
  records: readonly EventRecord[],
): ReplayPlan {
  const targets: ReplayTarget[] = [];
  const refusals: { eventId: string; refusal: ReplayRefusal }[] = [];

  for (const record of records) {
    // Consent as it stood at capture is the only consent that licenses this event, forever.
    if (!record.consentSnapshot.marketing) {
      refusals.push({ eventId: record.eventId, refusal: { code: "never_consented" } });
      continue;
    }

    const entries = eligibleEntries(record, request);
    if (entries.length === 0) {
      refusals.push({ eventId: record.eventId, refusal: { code: "no_eligible_destinations" } });
      continue;
    }

    for (const entry of entries) {
      const definition = deps.destinations.resolve(entry.destination);

      // Deleted / integration removed. No substitution is attempted.
      if (definition === null) {
        refusals.push({
          eventId: record.eventId,
          refusal: { code: "destination_missing", destination: entry.destination },
        });
        continue;
      }

      // The destination still exists but the exact configuration used at capture is gone. Using
      // today's configuration would replay the event against settings it never ran under.
      if (deps.destinations.resolveVersion !== undefined && entry.destinationVersion > 0) {
        const historical = deps.destinations.resolveVersion(
          entry.destination,
          entry.destinationVersion,
        );
        if (historical === null) {
          refusals.push({
            eventId: record.eventId,
            refusal: {
              code: "configuration_removed",
              destination: entry.destination,
              historicalVersion: entry.destinationVersion,
            },
          });
          continue;
        }
      }

      if (!definition.enabled) {
        refusals.push({
          eventId: record.eventId,
          refusal: { code: "destination_disabled", destination: entry.destination },
        });
        continue;
      }

      // Revoked credentials / disconnected workspace — caught in the dry run, not at transmission.
      const credentialRef = definition.endpoint.credentialRef;
      if (
        deps.credentials !== undefined &&
        credentialRef !== undefined &&
        !deps.credentials.isAvailable(credentialRef)
      ) {
        refusals.push({
          eventId: record.eventId,
          refusal: { code: "credentials_unavailable", destination: entry.destination },
        });
        continue;
      }

      // No payload means no deterministic replay is possible. Refuse rather than re-map.
      if (Object.keys(entry.renderedPayload).length === 0) {
        refusals.push({
          eventId: record.eventId,
          refusal: { code: "no_rendered_payload", destination: entry.destination },
        });
        continue;
      }

      targets.push({
        eventId: record.eventId,
        destination: entry.destination,
        renderedPayload: entry.renderedPayload,
        mappingKey: entry.mappingKey,
        mappingVersion: entry.mappingVersion,
        destinationVersion: entry.destinationVersion,
        dedupId: record.dedupId,
        ...(entry.payloadHash === undefined ? {} : { payloadHash: entry.payloadHash }),
      });
    }
  }

  return {
    replayId: request.replayId,
    scope: request.scope,
    targets,
    refusals,
    eventCount: records.length,
    targetCount: targets.length,
  };
}

/**
 * Verifies payload integrity, then plans.
 *
 * **This is the entry point a caller should use.** `planReplay` performs structural planning only;
 * it cannot verify digests because hashing is asynchronous. Verification happens here, before any
 * target is produced, so a corrupted record can never reach a plan — and therefore can never reach
 * transmission.
 *
 * A destination entry whose payload fails verification is refused with `payload_corrupted`; other
 * entries on the same event are unaffected, since corruption of one stored payload says nothing
 * about the others.
 */
export async function planReplayVerified(
  deps: PlanDeps & { readonly hasher: HashPort },
  request: ReplayRequest,
  records: readonly EventRecord[],
): Promise<ReplayPlan> {
  const verified: EventRecord[] = [];
  const integrityRefusals: { eventId: string; refusal: ReplayRefusal }[] = [];

  for (const record of records) {
    const surviving: DestinationHistoryEntry[] = [];

    for (const entry of record.destinationHistory) {
      // Entries with no payload are handled by structural planning (`no_rendered_payload`);
      // verifying an empty payload would report the wrong reason.
      if (Object.keys(entry.renderedPayload).length === 0) {
        surviving.push(entry);
        continue;
      }

      const result = await verifyPayloadDigest(
        entry.renderedPayload,
        entry.payloadHash,
        deps.hasher,
      );

      if (result.valid) {
        surviving.push(entry);
        continue;
      }

      integrityRefusals.push({
        eventId: record.eventId,
        refusal: {
          code: "payload_corrupted",
          destination: entry.destination,
          reason: result.reason,
        },
      });
    }

    verified.push({ ...record, destinationHistory: surviving });
  }

  const plan = planReplay(deps, request, verified);

  return {
    ...plan,
    refusals: [...integrityRefusals, ...plan.refusals],
    eventCount: records.length,
  };
}

/** Cooperative cancellation. Checked between targets so a large replay stops promptly. */
export interface ReplayCancellationPort {
  isCancelled(replayId: string): boolean;
}

export interface ReplayProgress {
  readonly replayId: string;
  readonly status: ReplayStatus;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

/** Sends one frozen payload. Implemented over the M4 delivery layer at the composition root. */
export interface ReplayDispatchPort {
  dispatch(target: ReplayTarget): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

export interface ExecuteDeps {
  readonly dispatch: ReplayDispatchPort;
  readonly cancellation?: ReplayCancellationPort;
  readonly onProgress?: (progress: ReplayProgress) => void;
  /**
   * Re-verifies each payload immediately before transmission. Plan-time verification already
   * happened; this catches corruption introduced *between* planning and sending — a long-running
   * replay over a restored dataset is exactly where that occurs.
   */
  readonly hasher?: HashPort;
}

/**
 * Executes a plan.
 *
 * A dry run returns the plan's shape without dispatching anything — the caller cannot accidentally
 * transmit by forgetting a flag, because `planReplay` and `executeReplay` are separate calls and
 * only the latter touches transport.
 */
export async function executeReplay(deps: ExecuteDeps, plan: ReplayPlan): Promise<ReplayProgress> {
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const target of plan.targets) {
    if (deps.cancellation?.isCancelled(plan.replayId) === true) {
      const cancelledProgress: ReplayProgress = {
        replayId: plan.replayId,
        status: "cancelled",
        attempted,
        succeeded,
        failed,
        cancelled: true,
      };
      deps.onProgress?.(cancelledProgress);
      return cancelledProgress;
    }

    attempted += 1;

    // Last-moment integrity check: never transmit bytes we cannot vouch for.
    if (deps.hasher !== undefined) {
      const integrity = await verifyPayloadDigest(
        target.renderedPayload,
        target.payloadHash,
        deps.hasher,
      );
      if (!integrity.valid) {
        failed += 1;
        deps.onProgress?.({
          replayId: plan.replayId,
          status: "running",
          attempted,
          succeeded,
          failed,
          cancelled: false,
        });
        continue;
      }
    }

    const result = await deps.dispatch.dispatch(target);
    if (result.ok) succeeded += 1;
    else failed += 1;

    deps.onProgress?.({
      replayId: plan.replayId,
      status: "running",
      attempted,
      succeeded,
      failed,
      cancelled: false,
    });
  }

  return {
    replayId: plan.replayId,
    status: failed === 0 ? "completed" : "failed",
    attempted,
    succeeded,
    failed,
    cancelled: false,
  };
}

/**
 * The stages a replay is permitted to run, exported as data so the determinism guarantee is
 * test-asserted rather than only described. Anything absent from this list must never execute
 * during a replay.
 */
export const REPLAY_STAGES = ["destination_routing", "delivery", "retry"] as const;

export type ReplayStage = (typeof REPLAY_STAGES)[number];

/** Pipeline stages explicitly forbidden during replay. */
export const REPLAY_FORBIDDEN_STAGES = [
  "capture",
  "normalize",
  "validate",
  "enrichment",
  "identity_stitching",
  "consent_resolution",
  "attribution",
  "pii_hashing",
  "platform_mapping",
  "destination_formatting",
] as const;
