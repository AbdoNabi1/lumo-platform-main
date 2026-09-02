/**
 * What kind of journey-graph edge connects two sessions. Organic kinds (`timed_out`,
 * `browser_restarted`, `device_changed`, `anonymous_to_identified`, `manual_logout`, `resumed`) are
 * recorded by `ObserveSession`/`CloseSession`/`ResumeSession` as a byproduct of normal ingestion;
 * explicit kinds (`explicit_merge`, `explicit_split`) are asserted by an operator via
 * `MergeSession`/`SplitSession`, carrying `reason`/`actor` the same way `IdentityDecision` does
 * (FF-CDP-03-style provenance) — see {@link requiresProvenance}.
 */
export type SessionTransitionKind =
  | "anonymous_to_identified"
  | "device_changed"
  | "browser_restarted"
  | "timed_out"
  | "manual_logout"
  | "resumed"
  | "explicit_merge"
  | "explicit_split";

export const EXPLICIT_TRANSITION_KINDS: readonly SessionTransitionKind[] = [
  "explicit_merge",
  "explicit_split",
];

export function requiresProvenance(kind: SessionTransitionKind): boolean {
  return EXPLICIT_TRANSITION_KINDS.includes(kind);
}

/**
 * One append-only edge in the journey graph — never updated or deleted, same discipline as
 * `IdentityDecision` (a correction is a new transition, not an edit). `fromSessionId`/
 * `toSessionId` are independently optional: a `timed_out` transition names both (old session →
 * new session opened on next activity past the idle window); an `anonymous_to_identified`
 * transition observed mid-session names only `fromSessionId` (no new session was opened, the same
 * session just gained an identity signal).
 */
export interface SessionTransition {
  readonly id: string;
  readonly kind: SessionTransitionKind;
  readonly visitorId: string;
  readonly fromSessionId?: string;
  readonly toSessionId?: string;
  readonly reason?: string;
  readonly actor?: string;
  readonly occurredAt: string;
}
