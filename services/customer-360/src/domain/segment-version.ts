/**
 * A `SegmentMembership` row's optimistic-read version — same reasoning as `AttributeVersion`: a
 * plain non-negative integer, not a wrapped value object, named only so a signature reads
 * `SegmentVersion` rather than an anonymous `number`. Unlike `AttributeVersion` (which versions a
 * whole per-identifier `ComputedAttribute` aggregate), this versions one `(identifier, segmentId)`
 * row directly — there is no aggregate wrapper in this engine (see `customer-segment.ts`'s module
 * doc for why).
 */
export type SegmentVersion = number;

export const INITIAL_SEGMENT_VERSION: SegmentVersion = 0;
