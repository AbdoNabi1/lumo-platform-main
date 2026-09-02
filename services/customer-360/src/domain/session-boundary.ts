/**
 * Why a session's boundary closed — the terminal reason recorded on `CustomerSession.closeReason`.
 * Distinct from `SessionTransitionKind` (`session-transition.ts`): a boundary describes *why this
 * one session ended*; a transition describes *how two sessions relate* in the journey chain, which
 * may or may not coincide with a boundary (an `explicit_merge` transition links two already-closed
 * or already-independent session chains without either session necessarily closing *because of*
 * the merge).
 */
export type SessionCloseReason =
  | "timeout"
  | "manual_logout"
  | "browser_restart"
  | "device_change"
  | "explicit_split"
  | "merged_away";

export const SESSION_CLOSE_REASONS: readonly SessionCloseReason[] = [
  "timeout",
  "manual_logout",
  "browser_restart",
  "device_change",
  "explicit_split",
  "merged_away",
];

export function isSessionCloseReason(value: string): value is SessionCloseReason {
  return (SESSION_CLOSE_REASONS as readonly string[]).includes(value);
}
