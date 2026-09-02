import type { CustomerSegment } from "./customer-segment";
import type { SegmentMembership } from "./segment-membership";

/**
 * Merges every cluster member's own segment memberships into one unified view — the Segmentation
 * analogue of `mergeComputedAttributes` (`domain/computed-attribute-views.ts`), same "per key, highest
 * version wins, tie-broken by the later `evaluatedAt`" rule, same reason: an identity cluster may have
 * had segment membership evaluated against each identifier independently before the link was ever
 * asserted, and the merge always prefers the freshest evaluation, never the union of stale ones.
 *
 * Unlike `mergeComputedAttributes`, there is no merged-view `version`/`updatedAt` to compute — see
 * `CustomerSegment`'s module doc.
 */
export function mergeCustomerSegments(
  segments: readonly CustomerSegment[],
  mergedIdentifierType: string,
  mergedIdentifierValue: string,
): CustomerSegment {
  const merged = new Map<string, SegmentMembership>();

  for (const segment of segments) {
    for (const [segmentId, membership] of segment.memberships) {
      const existing = merged.get(segmentId);
      if (
        existing === undefined ||
        membership.version > existing.version ||
        (membership.version === existing.version && membership.evaluatedAt > existing.evaluatedAt)
      ) {
        merged.set(segmentId, membership);
      }
    }
  }

  return {
    identifierType: mergedIdentifierType,
    identifierValue: mergedIdentifierValue,
    memberships: merged,
  };
}
