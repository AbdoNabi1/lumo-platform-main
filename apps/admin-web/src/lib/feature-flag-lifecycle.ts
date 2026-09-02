/**
 * T5.11b — UI-only copy of the backend's authoritative feature flag status transition table
 * (`services/feature-flags/src/domain/value-objects/flag-status.ts`'s `TRANSITIONS`). `apps/*` may
 * never import `services/*` (`docs/plans/README.md`'s global constraints), so this is a hand-kept
 * copy, not an import — if the backend's table ever changes, this one must be updated to match by
 * hand. Same technique as `lib/notification-lifecycle.ts`/`lib/review-lifecycle.ts`.
 *
 * Unlike Notifications/Reviews, no route dedicates itself to one specific transition target here —
 * `POST /feature-flags/:flagId/transitions` is the only status-changing route, so there is no
 * `canXFrom`/`DEDICATED_COVERED_TARGETS` split to make: the full table entry is always what the
 * generic "advance to…" control offers.
 */
export const FLAG_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  active: ["killed", "archived"],
  killed: ["active", "archived"],
  archived: [],
};

/**
 * The statuses `FeatureFlagLifecycleActions`' "advance to…" dropdown may offer from `status` — the
 * full transition table entry. Returns an empty array for the terminal `archived` status or an
 * unrecognized one, never throws.
 */
export function advanceableFlagStatusesFrom(status: string): readonly string[] {
  return FLAG_LIFECYCLE_TRANSITIONS[status] ?? [];
}
