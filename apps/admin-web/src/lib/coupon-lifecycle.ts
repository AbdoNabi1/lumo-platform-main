/**
 * T5.8 — UI-only copy of the backend's authoritative coupon status transition table
 * (`services/coupons/src/domain/value-objects/coupon-status.ts`). `apps/*` may never import
 * `services/*` (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this is a
 * hand-kept copy, not an import — if the backend's table ever changes, this one must be updated
 * to match by hand. Same technique as `lib/order-lifecycle.ts`'s `ORDER_LIFECYCLE_TRANSITIONS`.
 */
export const COUPON_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  active: ["disabled", "expired", "depleted"],
  disabled: ["active", "expired"],
  expired: [],
  depleted: [],
};

/**
 * The statuses the "advance to…" control may offer from `status`. Returns an empty array for a
 * terminal status (`expired`/`depleted`) or an unrecognized one — the caller renders no control
 * at all in that case, not a disabled one with nothing in it.
 */
export function couponAdvanceableStatusesFrom(status: string): readonly string[] {
  return COUPON_LIFECYCLE_TRANSITIONS[status] ?? [];
}
