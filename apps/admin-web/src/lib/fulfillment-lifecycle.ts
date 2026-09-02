/**
 * T5.4 — UI-only copy of the backend's authoritative fulfillment-order lifecycle transition table
 * (`services/fulfillment/src/domain/value-objects/fulfillment-status.ts`'s `TRANSITIONS`).
 * `apps/*` may never import `services/*` (`docs/plans/README.md`'s global constraints), so this is
 * a hand-kept copy, not an import — if the backend's table ever changes, this one must be updated
 * to match by hand. Same technique as `lib/order-lifecycle.ts`/`lib/return-lifecycle.ts`.
 */
export const FULFILLMENT_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  created: ["reservation_requested", "cancelled"],
  reservation_requested: ["confirmed", "failed"],
  confirmed: ["picking_started", "cancelled"],
  failed: ["reservation_requested", "cancelled"],
  picking_started: ["picking_completed"],
  picking_completed: ["packing_started"],
  packing_started: ["packing_completed"],
  packing_completed: ["shipment_created"],
  shipment_created: ["tracking_assigned"],
  tracking_assigned: ["shipment_dispatched"],
  shipment_dispatched: ["in_transit"],
  in_transit: ["out_for_delivery", "delivery_failed"],
  out_for_delivery: ["delivered", "delivery_failed"],
  delivered: ["returned", "closed"],
  delivery_failed: ["in_transit", "returned", "closed"],
  returned: ["closed"],
  cancelled: ["closed"],
  closed: [],
};

/**
 * Unlike Returns (where every dedicated route's implied target set exactly equals its status's
 * full transition-table entry, so a status either has a dedicated action XOR the generic advance
 * fallback), Fulfillment's two status-scoped dedicated routes only cover *some* of their status's
 * targets:
 * - `reserve` ("Request a stock reservation via the InventoryPort") only ever moves the order
 *   toward `reservation_requested` — offered at `created` and `failed`, the two statuses whose
 *   transition table lists `reservation_requested` as a target (`failed` is the retry path after a
 *   failed reservation attempt).
 * - `ship` ("Request a shipment from the carrier via the ShippingProviderPort") only ever moves the
 *   order toward `shipment_created` — offered at `packing_completed`, its sole predecessor.
 * `record_webhook` ("Record a carrier webhook (replay-safe)") is not scoped to one status at all —
 * it is how the carrier/inventory side of this domain reports back over time (reservation
 * confirmed/failed, tracking updates, delivery events), so it is offered whenever the fulfillment
 * order is not yet terminal, alongside whatever dedicated/advance controls that status also offers.
 */
const RESERVE_STATUSES: ReadonlySet<string> = new Set(["created", "failed"]);
const SHIP_STATUSES: ReadonlySet<string> = new Set(["packing_completed"]);
const WEBHOOK_HIDDEN_STATUSES: ReadonlySet<string> = new Set(["closed"]);

/**
 * The transition targets each dedicated action above is understood to cover at its status — used
 * only to compute the generic advance dropdown's residual options below, never to decide whether
 * the dedicated action itself renders (that's `canReserveFrom`/`canShipFrom`).
 */
const DEDICATED_COVERED_TARGETS: Readonly<Record<string, readonly string[]>> = {
  created: ["reservation_requested"],
  failed: ["reservation_requested"],
  packing_completed: ["shipment_created"],
};

/** Whether `FulfillmentLifecycleActions` should render the "Request reservation" button at `status`. */
export function canReserveFrom(status: string): boolean {
  return RESERVE_STATUSES.has(status);
}

/** Whether `FulfillmentLifecycleActions` should render the "Request shipment" button at `status`. */
export function canShipFrom(status: string): boolean {
  return SHIP_STATUSES.has(status);
}

/** Whether `FulfillmentLifecycleActions` should render the "Record carrier webhook" form at `status`. */
export function canRecordFulfillmentWebhookFrom(status: string): boolean {
  return !WEBHOOK_HIDDEN_STATUSES.has(status);
}

/**
 * The statuses the generic "advance to…" dropdown may offer from `status` — the full transition
 * table entry, minus whatever targets a dedicated action at this status already covers (so the
 * dropdown never duplicates a control the operator already has). Returns an empty array for a
 * terminal status, an unrecognized one, or a status whose only target is fully covered by a
 * dedicated action (e.g. `packing_completed`, covered entirely by `ship`) — the caller renders no
 * dropdown at all in that case, not a disabled one with nothing in it.
 */
export function advanceableFulfillmentStatusesFrom(status: string): readonly string[] {
  const all = FULFILLMENT_LIFECYCLE_TRANSITIONS[status] ?? [];
  const covered = DEDICATED_COVERED_TARGETS[status] ?? [];
  return all.filter((target) => !covered.includes(target));
}
