/**
 * T5.9a — UI-only copy of the backend's authoritative content block status transition table
 * (`services/content/src/domain/value-objects/content-status.ts`'s `TRANSITIONS`). `apps/*` may
 * never import `services/*` (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this
 * is a hand-kept copy, not an import — if the backend's table ever changes, this one must be
 * updated to match by hand. Same technique as `lib/order-lifecycle.ts`'s
 * `ORDER_LIFECYCLE_TRANSITIONS`.
 */
export const CONTENT_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["scheduled", "published", "archived"],
  scheduled: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

/**
 * The statuses the "advance to…" dropdown may offer from `status`. Returns an empty array for a
 * terminal status (`archived`) or an unrecognized one — the caller renders no control at all in
 * that case, not a disabled one with nothing in it.
 */
export function contentAdvanceableStatusesFrom(status: string): readonly string[] {
  return CONTENT_LIFECYCLE_TRANSITIONS[status] ?? [];
}
