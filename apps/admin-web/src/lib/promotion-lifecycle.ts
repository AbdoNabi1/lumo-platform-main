/**
 * T5.8 Part B — UI-only copy of the backend's authoritative promotion status transition table
 * (`services/promotions/src/domain/value-objects/promotion-status.ts`). `apps/*` may never
 * import `services/*` (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this is a
 * hand-kept copy, not an import — if the backend's table ever changes, this one must be updated
 * to match by hand. Same technique as `lib/order-lifecycle.ts`'s `ORDER_LIFECYCLE_TRANSITIONS`.
 */
export const PROMOTION_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["scheduled", "active", "cancelled", "archived"],
  scheduled: ["active", "cancelled", "archived"],
  active: ["paused", "expired", "depleted", "cancelled", "archived"],
  paused: ["active", "expired", "cancelled", "archived"],
  expired: ["archived"],
  depleted: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

/**
 * The statuses the "advance to…" dropdown may offer from `status`. Returns an empty array for a
 * terminal status (`archived`) or an unrecognized one — the caller renders no control at all in
 * that case, not a disabled one with nothing in it.
 */
export function promotionAdvanceableStatusesFrom(status: string): readonly string[] {
  return PROMOTION_LIFECYCLE_TRANSITIONS[status] ?? [];
}
