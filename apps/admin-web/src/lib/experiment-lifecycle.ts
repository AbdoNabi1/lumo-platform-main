/**
 * T5.11b — UI-only copy of the backend's authoritative experiment status transition table
 * (`services/experimentation/src/domain/value-objects/experiment-status.ts`'s `TRANSITIONS`).
 * `apps/*` may never import `services/*` (`docs/plans/README.md`'s global constraints), so this is
 * a hand-kept copy, not an import — if the backend's table ever changes, this one must be updated
 * to match by hand. Same technique as `lib/feature-flag-lifecycle.ts`/`lib/notification-lifecycle.ts`.
 *
 * No route dedicates itself to one specific transition target here — `POST
 * /experiments/:experimentId/transitions` is the only status-changing route, so there is no
 * `canXFrom`/`DEDICATED_COVERED_TARGETS` split to make: the full table entry is always what the
 * generic "advance to…" control offers.
 */
export const EXPERIMENT_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["running"],
  running: ["paused", "completed"],
  paused: ["running", "completed"],
  completed: ["archived"],
  archived: [],
};

/**
 * The statuses `ExperimentLifecycleActions`' "advance to…" dropdown may offer from `status` — the
 * full transition table entry. Returns an empty array for the terminal `archived` status or an
 * unrecognized one, never throws.
 */
export function advanceableExperimentStatusesFrom(status: string): readonly string[] {
  return EXPERIMENT_LIFECYCLE_TRANSITIONS[status] ?? [];
}
