import type { AttributeValue } from "./attribute-value";
import type { SegmentVersion } from "./segment-version";

/** Whether an identifier currently satisfies a segment's rule set. Unlike `AttributeValue`, this
 * engine's outcome is always boolean-shaped — a customer is either in a segment or not — so
 * membership is modeled as a transition, not a scored value. */
export type SegmentMembershipStatus = "entered" | "exited";

/**
 * One `(identifier, segmentId)` row — the unit of storage and optimistic concurrency in this engine
 * (`ports/segment-store.ts`), not a per-identifier aggregate the way `ComputedAttribute` is. See
 * `SEGMENTATION_MODEL.md` §2 for why: `GetSegmentMembers` needs to query across identifiers by
 * segment, which a single JSON blob per identifier (`ComputedAttributeCache`'s shape) cannot do.
 *
 * Carries the same explainability fields as `ComputedAttributeValue` (`matchedRuleIds`, `inputs`,
 * `definitionId`/`definitionVersion`, `evaluatedAt`) plus `enteredAt`/`exitedAt`, the timestamps of
 * this row's current membership period.
 */
export interface SegmentMembership {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly segmentId: string;
  readonly status: SegmentMembershipStatus;
  /** When the current (or, for an `"exited"` row, most recent) membership period began. `null` only
   * for a row that has never once been `"entered"` — which in practice never gets persisted at all
   * (see `applyMembershipUpdate`). */
  readonly enteredAt: string | null;
  /** When the current `"exited"` status began. Always `null` while `status === "entered"`. */
  readonly exitedAt: string | null;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly matchedRuleIds: readonly string[];
  readonly inputs: ReadonlyMap<string, AttributeValue>;
  readonly evaluatedAt: string;
  readonly version: SegmentVersion;
}

export interface MembershipUpdateInput {
  readonly isMember: boolean;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly matchedRuleIds: readonly string[];
  readonly inputs: ReadonlyMap<string, AttributeValue>;
  readonly evaluatedAt: string;
}

/** Which event, if any, a persisted update should raise. `"unchanged"` covers both a genuine no-op
 * and an `applied: true` refresh (e.g. a `definitionVersion` bump that leaves `status` unchanged) —
 * neither is a membership transition, so neither publishes `CustomerEnteredSegment`/
 * `CustomerExitedSegment`. */
export type MembershipTransition = "entered" | "exited" | "unchanged";

export interface MembershipUpdateResult {
  /** `null` only when there was nothing to persist at all — an identifier that has never been a
   * segment member and still isn't (see `applyMembershipUpdate`). Whenever `applied` is `true`,
   * always non-null. */
  readonly membership: SegmentMembership | null;
  /**
   * `false` when nothing changed worth persisting: either (a) the identifier has never been a member
   * of this segment and the fresh evaluation again says "not a member" — there is no row to update
   * and creating one would mean a row per (identifier, segment) pair even for segments an identifier
   * never matched, an unbounded and pointless expansion `ComputedAttributeCache` never risks; or (b)
   * an existing row's `status` and `definitionVersion` both match the fresh evaluation exactly — the
   * same no-op guard `applyAttributeUpdate` uses, adapted from "same value" to "same status".
   *
   * Mirrors `AttributeUpdateResult.applied`'s role in Incremental Evaluation: only an applied change
   * is worth persisting, but (per `transition`, next) not every applied change is worth publishing.
   */
  readonly applied: boolean;
  readonly transition: MembershipTransition;
}

function nextTimestamps(
  existing: SegmentMembership | null,
  nextStatus: SegmentMembershipStatus,
  statusChanged: boolean,
  evaluatedAt: string,
): { readonly enteredAt: string | null; readonly exitedAt: string | null } {
  if (nextStatus === "entered") {
    // A fresh entry, or a re-entry after having exited, resets `enteredAt` to now; staying entered
    // (a definitionVersion-only refresh) preserves the original entry time.
    return {
      enteredAt: statusChanged ? evaluatedAt : (existing?.enteredAt ?? evaluatedAt),
      exitedAt: null,
    };
  }
  return {
    enteredAt: existing?.enteredAt ?? null,
    exitedAt: statusChanged ? evaluatedAt : (existing?.exitedAt ?? evaluatedAt),
  };
}

/**
 * Applies one `(identifier, segmentId)` row's freshly evaluated membership, append-only: never
 * mutates `existing`, always returns a new row (or, when nothing is worth persisting, `null`).
 *
 * A pure, total function of `(existing, update)` — see `MembershipUpdateResult.applied`'s doc for the
 * two no-op cases. `transition` is computed independently of `applied` (§6 of
 * `SEGMENTATION_MODEL.md`): it is `"entered"`/`"exited"` exactly when `status` itself flips, and
 * `"unchanged"` both for a true no-op and for an applied version-bump refresh that leaves `status`
 * the same — the caller (`UpdateSegmentMembershipProjection`) persists whenever `applied`, but
 * publishes an integration event only when `transition !== "unchanged"`.
 */
export function applyMembershipUpdate(
  existing: SegmentMembership | null,
  identifierType: string,
  identifierValue: string,
  segmentId: string,
  update: MembershipUpdateInput,
): MembershipUpdateResult {
  const nextStatus: SegmentMembershipStatus = update.isMember ? "entered" : "exited";

  if (existing === null && nextStatus === "exited") {
    return { membership: null, applied: false, transition: "unchanged" };
  }

  const statusChanged = existing === null || existing.status !== nextStatus;
  const isNoOp =
    !statusChanged && existing !== null && existing.definitionVersion === update.definitionVersion;

  if (isNoOp) {
    return { membership: existing, applied: false, transition: "unchanged" };
  }

  const { enteredAt, exitedAt } = nextTimestamps(
    existing,
    nextStatus,
    statusChanged,
    update.evaluatedAt,
  );

  const membership: SegmentMembership = {
    identifierType,
    identifierValue,
    segmentId,
    status: nextStatus,
    enteredAt,
    exitedAt,
    definitionId: update.definitionId,
    definitionVersion: update.definitionVersion,
    matchedRuleIds: update.matchedRuleIds,
    inputs: update.inputs,
    evaluatedAt: update.evaluatedAt,
    version: existing === null ? 1 : existing.version + 1,
  };

  return {
    membership,
    applied: true,
    transition: statusChanged ? nextStatus : "unchanged",
  };
}
