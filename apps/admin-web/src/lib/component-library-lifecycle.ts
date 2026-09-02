/**
 * T5.9c — UI-only copy of the backend's authoritative Component Definition status transition
 * table (`services/components/src/domain/component-definition.ts`'s `TRANSITIONS`). `apps/*` may
 * never import `services/*` (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this
 * is a hand-kept copy, not an import — if the backend's table ever changes, this one must be
 * updated to match by hand. Same technique as `lib/theme-lifecycle.ts`'s
 * `THEME_LIFECYCLE_TRANSITIONS`.
 */
export const COMPONENT_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["published", "archived"],
  published: ["deprecated", "archived"],
  deprecated: ["archived"],
  archived: [],
};

/**
 * The statuses the "advance to…" dropdown may offer from `status`. Returns an empty array for a
 * terminal status (`archived`) or an unrecognized one — the caller renders no control at all in
 * that case, not a disabled one with nothing in it.
 */
export function componentAdvanceableStatusesFrom(status: string): readonly string[] {
  return COMPONENT_LIFECYCLE_TRANSITIONS[status] ?? [];
}
