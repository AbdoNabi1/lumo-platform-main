/**
 * T5.3 — UI-only copy of the backend's authoritative return-request lifecycle transition table
 * (`services/returns/src/domain/value-objects/return-status.ts`'s `TRANSITIONS`). `apps/*` may
 * never import `services/*` (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this
 * is a hand-kept copy, not an import — if the backend's table ever changes, this one must be
 * updated to match by hand. Same technique as `lib/order-lifecycle.ts`'s `ORDER_LIFECYCLE_TRANSITIONS`.
 */
export const RETURN_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  requested: ["approved", "rejected"],
  approved: ["rma_generated"],
  rejected: ["closed"],
  rma_generated: ["package_received"],
  package_received: ["inspection_completed"],
  inspection_completed: ["items_accepted", "items_rejected"],
  items_accepted: ["refund_requested", "replacement_requested", "repair_requested"],
  items_rejected: ["closed"],
  refund_requested: ["closed"],
  replacement_requested: ["closed"],
  repair_requested: ["closed"],
  closed: [],
};

/**
 * Every edge in the table above already has a dedicated write route that implies a specific
 * transition (`decision` at `requested`, `rma` at `approved`, `receive` at `rma_generated`,
 * `inspection` at `package_received`, `accept` at `inspection_completed`, `resolution` at
 * `items_accepted`) — this set is exactly the statuses with no dedicated action, i.e. the ones
 * that only reach their next status (always `closed`) via the generic `POST
 * /returns/:returnId/transitions` (advance) route. `ReturnLifecycleActions` uses this to decide
 * whether to render the dedicated action or the generic "advance to…" fallback.
 */
const DEDICATED_ACTION_STATUSES: ReadonlySet<string> = new Set([
  "requested",
  "approved",
  "rma_generated",
  "package_received",
  "inspection_completed",
  "items_accepted",
]);

export function hasDedicatedActionFrom(status: string): boolean {
  return DEDICATED_ACTION_STATUSES.has(status);
}

/**
 * The statuses the generic "advance to…" dropdown may offer from `status` — only ever rendered
 * for a status with no dedicated action (see `hasDedicatedActionFrom`). Returns an empty array for
 * a terminal status (`closed`) or an unrecognized one; the caller renders no control at all in
 * that case, not a disabled one with nothing in it.
 */
export function advanceableReturnStatusesFrom(status: string): readonly string[] {
  return RETURN_LIFECYCLE_TRANSITIONS[status] ?? [];
}
