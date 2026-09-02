/**
 * T5.9a — UI-only copy of the backend's authoritative Page status transition table
 * (`services/pages/src/domain/page.ts`'s `TRANSITIONS`). `apps/*` may never import `services/*`
 * (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this is a hand-kept copy, not
 * an import — if the backend's table ever changes, this one must be updated to match by hand.
 * Same technique as `lib/order-lifecycle.ts`'s `ORDER_LIFECYCLE_TRANSITIONS`.
 */
export const PAGE_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

/**
 * The statuses the "advance to…" dropdown may offer from `status`. Returns an empty array for a
 * terminal status (`archived`) or an unrecognized one — the caller renders no control at all in
 * that case, not a disabled one with nothing in it.
 */
export function pageAdvanceableStatusesFrom(status: string): readonly string[] {
  return PAGE_LIFECYCLE_TRANSITIONS[status] ?? [];
}

/**
 * Template (`services/pages/src/domain/template.ts`) has no transition table at all — its only
 * lifecycle move is `archive()`, which the aggregate itself rejects once `status === "archived"`
 * (`BusinessRuleError("Template is already archived")`). So there is nothing to copy as a table;
 * this just gates the archive button on "not already archived", per the task brief.
 */
export function templateCanArchive(status: string): boolean {
  return status !== "archived";
}
