import type { SegmentMembership } from "./segment-membership";

/**
 * The materialized set of segment memberships for one identifier — the Segmentation analogue of
 * `ComputedAttribute`, but assembled at read time from independently-stored `SegmentMembership` rows
 * rather than itself being one stored row. There is no `version`/`updatedAt` at this level (unlike
 * `ComputedAttribute`): each membership already carries its own, and a merged multi-segment view is
 * never itself persisted or compare-and-swapped (`SEGMENTATION_MODEL.md` §2).
 *
 * Holds every known membership regardless of `status` — callers filter to `status === "entered"` for
 * "segments this customer is currently in"; the full map (including `"exited"` rows) is what powers
 * "segments this customer was ever in."
 */
export interface CustomerSegment {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly memberships: ReadonlyMap<string, SegmentMembership>;
}

export function toCustomerSegment(
  identifierType: string,
  identifierValue: string,
  memberships: readonly SegmentMembership[],
): CustomerSegment {
  const map = new Map<string, SegmentMembership>();
  for (const membership of memberships) {
    map.set(membership.segmentId, membership);
  }
  return { identifierType, identifierValue, memberships: map };
}
