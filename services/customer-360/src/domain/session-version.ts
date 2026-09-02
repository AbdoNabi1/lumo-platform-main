/**
 * A session's optimistic-read version — same rationale as `ProfileVersion` (`profile-version.ts`):
 * a plain non-negative integer, not a wrapped value object, named as its own type purely so
 * signatures read `SessionVersion` rather than an anonymous `number`. Deliberately not a reuse of
 * `ProfileVersion` — the two count unrelated things (a session's own mutation count vs. a
 * profile's field-write count), and coupling them would mean an unrelated future change to one
 * silently affects the other's semantics (the same reasoning `ProfileFieldConfidence`'s doc comment
 * already gives for not reusing `IdentityConfidence`).
 */
export type SessionVersion = number;

export const INITIAL_SESSION_VERSION: SessionVersion = 0;
