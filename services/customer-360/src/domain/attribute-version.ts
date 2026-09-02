/**
 * A computed attribute's (or the whole `ComputedAttribute` aggregate's) optimistic-read version —
 * same reasoning as `ProfileVersion`: a plain non-negative integer, not a wrapped value object,
 * named only so a signature reads `AttributeVersion` rather than an anonymous `number`.
 */
export type AttributeVersion = number;

export const INITIAL_ATTRIBUTE_VERSION: AttributeVersion = 0;
