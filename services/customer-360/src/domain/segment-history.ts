import type { SegmentMembership, SegmentMembershipStatus } from "./segment-membership";

/** Why a snapshot was captured. Unlike `AttributeSnapshotReason` (`created`/`updated`/`rebuilt`),
 * membership is transition-shaped, so the ledger records the transition itself
 * (`"entered"`/`"exited"`) rather than a generic `"updated"` for the common case. `"refreshed"`
 * covers the one case that is neither a transition nor a no-op: an applied change
 * (`MembershipUpdateResult.applied === true`) whose `transition` is `"unchanged"` — a
 * `definitionVersion` bump that leaves `status` the same. This still must be appended (never skipped)
 * so `SegmentStore`'s cache stays rebuildable from `SegmentHistoryStore` exactly as of every applied
 * write, not just every transitioning one — skipping it would mean `RebuildSegmentMembership` replays
 * a stale `definitionVersion`/`inputs`/`matchedRuleIds` after a refresh-only update. */
export type SegmentHistoryReason = "entered" | "exited" | "refreshed" | "rebuilt";

/**
 * An immutable, full capture of one `SegmentMembership` row at one version — the durable, append-only
 * ledger entry (`SegmentHistoryStore`), mirroring `AttributeSnapshot`'s full-capture (not diff-only)
 * contract exactly.
 */
export interface SegmentHistoryEntry {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly segmentId: string;
  readonly status: SegmentMembershipStatus;
  readonly enteredAt: string | null;
  readonly exitedAt: string | null;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly matchedRuleIds: readonly string[];
  readonly inputs: SegmentMembership["inputs"];
  readonly evaluatedAt: string;
  readonly version: number;
  readonly capturedAt: string;
  readonly reason: SegmentHistoryReason;
}

export function toSnapshot(
  membership: SegmentMembership,
  reason: SegmentHistoryReason,
  capturedAt: string,
): SegmentHistoryEntry {
  return {
    identifierType: membership.identifierType,
    identifierValue: membership.identifierValue,
    segmentId: membership.segmentId,
    status: membership.status,
    enteredAt: membership.enteredAt,
    exitedAt: membership.exitedAt,
    definitionId: membership.definitionId,
    definitionVersion: membership.definitionVersion,
    matchedRuleIds: membership.matchedRuleIds,
    inputs: membership.inputs,
    evaluatedAt: membership.evaluatedAt,
    version: membership.version,
    capturedAt,
    reason,
  };
}

/** Reconstructs a `SegmentMembership` row from its latest snapshot — the whole of "rebuild": each
 * snapshot already carries the full row, so recovery never needs to fold history. */
export function fromSnapshot(snapshot: SegmentHistoryEntry): SegmentMembership {
  return {
    identifierType: snapshot.identifierType,
    identifierValue: snapshot.identifierValue,
    segmentId: snapshot.segmentId,
    status: snapshot.status,
    enteredAt: snapshot.enteredAt,
    exitedAt: snapshot.exitedAt,
    definitionId: snapshot.definitionId,
    definitionVersion: snapshot.definitionVersion,
    matchedRuleIds: snapshot.matchedRuleIds,
    inputs: snapshot.inputs,
    evaluatedAt: snapshot.evaluatedAt,
    version: snapshot.version,
  };
}
