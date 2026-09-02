/**
 * T5.4 — UI-only copy of the backend's authoritative shipment lifecycle transition table
 * (`services/shipping/src/domain/value-objects/shipment-status.ts`'s `TRANSITIONS`). `apps/*` may
 * never import `services/*` (`docs/plans/README.md`'s global constraints), so this is a hand-kept
 * copy, not an import — if the backend's table ever changes, this one must be updated to match by
 * hand. Same technique as `lib/fulfillment-lifecycle.ts`.
 */
export const SHIPMENT_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  created: ["label_created", "voided", "cancelled"],
  label_created: ["carrier_accepted", "rejected", "voided", "cancelled"],
  voided: ["created", "closed"],
  carrier_accepted: ["in_transit", "cancelled"],
  rejected: ["created", "cancelled"],
  in_transit: ["out_for_delivery", "exception"],
  out_for_delivery: ["delivered", "delivery_failed"],
  delivered: ["returned", "closed"],
  delivery_failed: ["in_transit", "exception", "closed"],
  returned: ["closed"],
  exception: ["created", "closed"],
  cancelled: ["closed"],
  closed: [],
};

/**
 * Same "dedicated route covers only some of a status's targets" situation as
 * `lib/fulfillment-lifecycle.ts` (unlike Returns' exact XOR split):
 * - `label` ("Request a label from the carrier via the CarrierProviderPort") only ever moves the
 *   shipment toward `label_created` — offered at `created`, the sole predecessor.
 * - `label-void` ("Void the shipment's label at the carrier") only ever moves the shipment toward
 *   `voided` — offered at `label_created`, where a real label exists to void.
 * - `tracking` ("Append a carrier tracking scan to the shipment's history") is not a status
 *   transition at all, just a log append — offered at the three "in motion" statuses where a scan
 *   is meaningful (`carrier_accepted`, `in_transit`, `out_for_delivery`).
 * - `retry` ("Retry a shipment from a recoverable state") is explicitly the brief's 3 named
 *   recoverable states (`rejected`, `delivery_failed`, `exception`) — surfaced as its own dedicated
 *   button rather than folded into the generic advance dropdown, per the brief's own instruction.
 *   `rejected`'s and `exception`'s transition tables both list `created` as a target (retrying
 *   sends the shipment back to `created` to try again); `delivery_failed`'s lists `in_transit`
 *   (retrying resumes transit) — both read as the retry route's implied effect.
 * `record_webhook` is, like Fulfillment's, not scoped to one status — offered whenever the
 * shipment is not yet terminal.
 */
const LABEL_STATUSES: ReadonlySet<string> = new Set(["created"]);
const LABEL_VOID_STATUSES: ReadonlySet<string> = new Set(["label_created"]);
const TRACKING_STATUSES: ReadonlySet<string> = new Set([
  "carrier_accepted",
  "in_transit",
  "out_for_delivery",
]);
const RETRY_STATUSES: ReadonlySet<string> = new Set(["rejected", "delivery_failed", "exception"]);
const WEBHOOK_HIDDEN_STATUSES: ReadonlySet<string> = new Set(["closed"]);

/**
 * The transition targets each dedicated action above is understood to cover at its status — used
 * only to compute the generic advance dropdown's residual options below, never to decide whether
 * the dedicated action itself renders.
 */
const DEDICATED_COVERED_TARGETS: Readonly<Record<string, readonly string[]>> = {
  created: ["label_created"],
  label_created: ["voided"],
  rejected: ["created"],
  delivery_failed: ["in_transit"],
  exception: ["created"],
};

/** Whether `ShipmentLifecycleActions` should render the "Create label" button at `status`. */
export function canCreateLabelFrom(status: string): boolean {
  return LABEL_STATUSES.has(status);
}

/** Whether `ShipmentLifecycleActions` should render the "Void label" button at `status`. */
export function canVoidLabelFrom(status: string): boolean {
  return LABEL_VOID_STATUSES.has(status);
}

/** Whether `ShipmentLifecycleActions` should render the "Add tracking scan" form at `status`. */
export function canUpdateTrackingFrom(status: string): boolean {
  return TRACKING_STATUSES.has(status);
}

/** Whether `ShipmentLifecycleActions` should render the dedicated "Retry" button at `status`. */
export function canRetryFrom(status: string): boolean {
  return RETRY_STATUSES.has(status);
}

/** Whether `ShipmentLifecycleActions` should render the "Record carrier webhook" form at `status`. */
export function canRecordShipmentWebhookFrom(status: string): boolean {
  return !WEBHOOK_HIDDEN_STATUSES.has(status);
}

/**
 * The statuses the generic "advance to…" dropdown may offer from `status` — the full transition
 * table entry, minus whatever targets a dedicated action at this status already covers. Returns an
 * empty array for a terminal status, an unrecognized one, or a status fully covered by a dedicated
 * action — the caller renders no dropdown at all in that case.
 */
export function advanceableShipmentStatusesFrom(status: string): readonly string[] {
  const all = SHIPMENT_LIFECYCLE_TRANSITIONS[status] ?? [];
  const covered = DEDICATED_COVERED_TARGETS[status] ?? [];
  return all.filter((target) => !covered.includes(target));
}
