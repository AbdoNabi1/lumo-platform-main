/**
 * T5.10 — UI-only copy of the backend's authoritative review status transition table
 * (`services/reviews/src/domain/value-objects/review-status.ts`'s `TRANSITIONS`). `apps/*` may
 * never import `services/*` (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this
 * is a hand-kept copy, not an import — if the backend's table ever changes, this one must be
 * updated to match by hand. Same technique as `lib/order-lifecycle.ts`'s
 * `ORDER_LIFECYCLE_TRANSITIONS`.
 */
export const REVIEW_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending: ["published", "rejected"],
  published: ["flagged", "removed"],
  rejected: [],
  flagged: ["published", "removed"],
  removed: [],
};

/**
 * `POST /reviews/:reviewId/moderate`'s 4 actions map onto specific transitions in the table above:
 * - `reject`  — `pending` -> `rejected` (offered only at `pending`)
 * - `flag`    — `published` -> `flagged` (offered only at `published`; there is no dedicated way
 *   to flag straight from `pending` even though nothing else models that move either — `flag` is
 *   the moderator response to something already live)
 * - `restore` — `flagged` -> `published` (offered only at `flagged`)
 * - `remove`  — `published`/`flagged` -> `removed` (offered at both)
 *
 * Unlike Returns (where every status either has a dedicated action covering its *entire*
 * transition-table entry XOR the generic advance fallback), `pending`'s `published` target has no
 * dedicated `moderate` action at all — `moderate`'s actions cover moderator *responses*
 * (reject/flag/restore/remove), not the plain "approve and publish" move, which is why the generic
 * advance dropdown is still needed at `pending` (see `DEDICATED_COVERED_TARGETS`/
 * `advanceableReviewStatusesFrom` below — same "residual gets the generic dropdown" technique
 * `lib/fulfillment-lifecycle.ts`'s own doc comment describes for T5.4).
 */
const REJECT_STATUSES: ReadonlySet<string> = new Set(["pending"]);
const FLAG_STATUSES: ReadonlySet<string> = new Set(["published"]);
const RESTORE_STATUSES: ReadonlySet<string> = new Set(["flagged"]);
const REMOVE_STATUSES: ReadonlySet<string> = new Set(["published", "flagged"]);

/** Whether `ReviewLifecycleActions` should offer the "Reject" moderate action at `status`. */
export function canRejectFrom(status: string): boolean {
  return REJECT_STATUSES.has(status);
}

/** Whether `ReviewLifecycleActions` should offer the "Flag" moderate action at `status`. */
export function canFlagFrom(status: string): boolean {
  return FLAG_STATUSES.has(status);
}

/** Whether `ReviewLifecycleActions` should offer the "Restore" moderate action at `status`. */
export function canRestoreFrom(status: string): boolean {
  return RESTORE_STATUSES.has(status);
}

/** Whether `ReviewLifecycleActions` should offer the "Remove" moderate action at `status`. */
export function canRemoveFrom(status: string): boolean {
  return REMOVE_STATUSES.has(status);
}

/**
 * The transition targets the 4 dedicated `moderate` actions are understood to cover at each
 * status — used only to compute the generic advance dropdown's residual options below, never to
 * decide whether a dedicated action itself renders (that's `canRejectFrom`/`canFlagFrom`/
 * `canRestoreFrom`/`canRemoveFrom`).
 */
const DEDICATED_COVERED_TARGETS: Readonly<Record<string, readonly string[]>> = {
  pending: ["rejected"],
  published: ["flagged", "removed"],
  flagged: ["published", "removed"],
};

/**
 * The statuses the generic "advance to…" dropdown may offer from `status` — the full transition
 * table entry, minus whatever targets a dedicated `moderate` action at this status already covers.
 * Only `pending` has a residual (`published` — approving a review straight to live has no
 * dedicated moderate action). Returns an empty array for a terminal status (`rejected`/`removed`),
 * an unrecognized one, or a status fully covered by dedicated actions (`published`/`flagged`) —
 * the caller renders no dropdown at all in that case, not a disabled one with nothing in it.
 */
export function advanceableReviewStatusesFrom(status: string): readonly string[] {
  const all = REVIEW_LIFECYCLE_TRANSITIONS[status] ?? [];
  const covered = DEDICATED_COVERED_TARGETS[status] ?? [];
  return all.filter((target) => !covered.includes(target));
}
