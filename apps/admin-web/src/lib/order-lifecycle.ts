/**
 * T5.2 — UI-only copy of the backend's authoritative order lifecycle transition table
 * (`services/orders/src/domain/order-event.ts`'s `TRANSITIONS`). `apps/*` may never import
 * `services/*` (see `docs/plans/README.md`'s Phase 5/6 global constraints), so this is a
 * hand-kept copy, not an import — if the backend's table ever changes, this one must be updated
 * to match by hand.
 */
export const ORDER_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  placed: ["paid", "cancelled"],
  paid: ["refunded"],
  refunded: [],
  created: ["confirmed", "cancelled"],
  confirmed: ["awaiting_payment", "held", "cancelled"],
  held: ["resumed", "cancelled"],
  resumed: ["awaiting_payment"],
  awaiting_payment: ["payment_requested", "cancelled"],
  payment_requested: ["payment_received", "payment_failed"],
  payment_failed: ["payment_requested", "cancelled"],
  payment_received: ["ready_for_fulfillment"],
  ready_for_fulfillment: ["fulfillment_requested"],
  fulfillment_requested: ["fulfilled", "partially_fulfilled"],
  partially_fulfilled: ["fulfilled"],
  fulfilled: ["delivered"],
  delivered: ["return_requested", "closed"],
  return_requested: ["returned"],
  returned: ["refund_requested", "closed"],
  refund_requested: ["closed"],
  cancelled: ["closed"],
  closed: [],
};

/**
 * `paid`/`payment_received` are only ever asserted via `POST /orders/:orderId/mark-paid` — the
 * backend's `advanceOrderBody` zod refinement (`apps/admin/src/http/admin-routes.ts`) rejects
 * them on `/advance` even though the transition table above allows them as targets. The "advance
 * to…" dropdown must not offer them either.
 */
const PAYMENT_COMPLETION_STATUSES: ReadonlySet<string> = new Set(["paid", "payment_received"]);

/**
 * The statuses the "advance to…" dropdown may offer from `status`. Returns an empty array for a
 * terminal status (e.g. `refunded`, `closed`) or one with no non-payment-completion targets — the
 * caller renders no control at all in that case, not a disabled one with nothing in it.
 */
export function advanceableStatusesFrom(status: string): readonly string[] {
  const next = ORDER_LIFECYCLE_TRANSITIONS[status] ?? [];
  return next.filter((candidate) => !PAYMENT_COMPLETION_STATUSES.has(candidate));
}

/**
 * Whether the "Refund" action should be offered from `status` — the legacy `paid` status (which
 * transitions straight to `refunded`), or `returned`/`refund_requested` in the full lifecycle.
 * Refund itself isn't a modeled transition target in the table above, so this is a curated
 * allowlist rather than a table lookup.
 */
export function canRefundFrom(status: string): boolean {
  return status === "paid" || status === "returned" || status === "refund_requested";
}
