import { ValueObject } from "@platform/domain";

export type FulfillmentStatusValue =
  | "created"
  | "reservation_requested"
  | "confirmed"
  | "failed"
  | "picking_started"
  | "picking_completed"
  | "packing_started"
  | "packing_completed"
  | "shipment_created"
  | "tracking_assigned"
  | "shipment_dispatched"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | "returned"
  | "cancelled"
  | "closed";

/**
 * The validated lifecycle transition table (Sprint 4.9). Local carriers (spec 9a) add edges only:
 * a voided label returns `shipment_created`/`tracking_assigned` to `packing_completed`, and a
 * parcel can come back (`returned`) from `in_transit`/`out_for_delivery`.
 */
const TRANSITIONS: Readonly<Record<FulfillmentStatusValue, readonly FulfillmentStatusValue[]>> = {
  created: ["reservation_requested", "cancelled"],
  reservation_requested: ["confirmed", "failed"],
  confirmed: ["picking_started", "cancelled"],
  failed: ["reservation_requested", "cancelled"],
  picking_started: ["picking_completed"],
  picking_completed: ["packing_started"],
  packing_started: ["packing_completed"],
  packing_completed: ["shipment_created"],
  shipment_created: ["tracking_assigned", "packing_completed"],
  tracking_assigned: ["shipment_dispatched", "packing_completed"],
  shipment_dispatched: ["in_transit"],
  in_transit: ["out_for_delivery", "delivery_failed", "returned"],
  out_for_delivery: ["delivered", "delivery_failed", "returned"],
  delivered: ["returned", "closed"],
  delivery_failed: ["in_transit", "returned", "closed"],
  returned: ["closed"],
  cancelled: ["closed"],
  closed: [],
};

/** Whether a transition from `from` to `to` is allowed by the fulfillment lifecycle's transition table. */
export function canTransitionFulfillment(
  from: FulfillmentStatusValue,
  to: FulfillmentStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Statuses a carrier walk may pass through on the way to its target. `delivery_failed` is
 * deliberately absent (as in shipping's `carrierPathTo`): a late scan never invents a failure or
 * walks backwards. It can still be the walk's target or starting status.
 */
const CARRIER_WALKABLE = new Set<FulfillmentStatusValue>([
  "tracking_assigned",
  "shipment_dispatched",
  "in_transit",
  "out_for_delivery",
]);

/** Targets reachable by walking; every other target needs a direct edge. */
const CARRIER_WALK_TARGETS = new Set<FulfillmentStatusValue>([
  "shipment_dispatched",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returned",
]);

/**
 * The shortest walk over the transition table from `from` to `to` for carrier scans that skip
 * steps (spec 9a.4). Returns the steps after `from`, ending with `to`; `[]` when equal; `null`
 * when unreachable (the mirror is then a no-op, never an error).
 */
export function fulfillmentCarrierPathTo(
  from: FulfillmentStatusValue,
  to: FulfillmentStatusValue,
): readonly FulfillmentStatusValue[] | null {
  if (from === to) return [];
  if (!CARRIER_WALK_TARGETS.has(to)) return canTransitionFulfillment(from, to) ? [to] : null;
  const previous = new Map<FulfillmentStatusValue, FulfillmentStatusValue>();
  const queue: FulfillmentStatusValue[] = [from];
  while (queue.length > 0) {
    const node = queue.shift() as FulfillmentStatusValue;
    for (const next of TRANSITIONS[node]) {
      if (previous.has(next) || next === from) continue;
      if (next !== to && !CARRIER_WALKABLE.has(next)) continue;
      previous.set(next, node);
      if (next === to) {
        const path: FulfillmentStatusValue[] = [to];
        for (let at = node; at !== from; at = previous.get(at) as FulfillmentStatusValue) {
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

interface FulfillmentStatusProps {
  readonly value: FulfillmentStatusValue;
}

/** The lifecycle state of a fulfillment order (a closed set of internal states; not external input). */
export class FulfillmentStatus extends ValueObject<FulfillmentStatusProps> {
  static created(): FulfillmentStatus {
    return new FulfillmentStatus({ value: "created" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: FulfillmentStatusValue): FulfillmentStatus {
    return new FulfillmentStatus({ value });
  }

  get value(): FulfillmentStatusValue {
    return this.props.value;
  }
}
