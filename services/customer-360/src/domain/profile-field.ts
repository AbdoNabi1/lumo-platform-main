import type { ProfileVersion } from "./profile-version";

/**
 * How much a profile field's value should be trusted. Deliberately a **local** type, not a reuse of
 * `@platform/tracking`'s `IdentityConfidence` ("deterministic" | "probabilistic") — that type scores
 * evidence for an identity *link*; this one scores trust in a *data value* asserted by a source. The
 * two axes are unrelated even though both happen to be two-valued, and coupling them would mean an
 * unrelated future change to identity-linking confidence silently changes profile semantics.
 *
 * `verified` — the value came from an authoritative system-of-record write (e.g. an order's shipping
 * address at the moment of purchase). `inferred` — the value was derived, enriched, or estimated.
 */
export type ProfileFieldConfidence = "verified" | "inferred";

/**
 * One field on a {@link CustomerProfile}. Every field carries its own provenance — never just a bare
 * value — per the Phase 6.2 contract: source, updatedAt, confidence, version are mandatory on every
 * field, not optional metadata bolted on later.
 */
export interface ProfileField<T = unknown> {
  readonly value: T;
  /** What asserted this value — a context/producer name (e.g. "orders", "loyalty"), never a raw
   * event payload. */
  readonly source: string;
  /** ISO-8601 UTC instant the asserting fact occurred (not when this field was written locally). */
  readonly updatedAt: string;
  readonly confidence: ProfileFieldConfidence;
  /** Monotonically increasing per-field version — bumped only when this specific field changes. */
  readonly version: ProfileVersion;
}

export function createProfileField<T>(
  value: T,
  source: string,
  updatedAt: string,
  confidence: ProfileFieldConfidence,
  version: ProfileVersion,
): ProfileField<T> {
  return { value, source, updatedAt, confidence, version };
}
