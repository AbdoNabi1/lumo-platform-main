import { ValueObject } from "@platform/domain";

export type ShipmentStatusValue =
  | "created"
  | "label_created"
  | "voided"
  | "carrier_accepted"
  | "rejected"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | "returned"
  | "exception"
  | "cancelled"
  | "closed";

/**
 * The validated lifecycle transition table (Sprint 4.10). Recoverable states
 * (`rejected`/`delivery_failed`/`exception`) can retry forward. Local carriers (spec §9a.4) add
 * edges only: `created → exception` (a lost label response), `returned` from every in-flight state,
 * `in_transit → delivery_failed`, and a carrier cancel from `carrier_accepted`/`in_transit`.
 */
const TRANSITIONS: Readonly<Record<ShipmentStatusValue, readonly ShipmentStatusValue[]>> = {
  created: ["label_created", "voided", "cancelled", "exception"],
  label_created: ["carrier_accepted", "rejected", "voided", "cancelled"],
  voided: ["created", "closed"],
  carrier_accepted: ["in_transit", "cancelled"],
  rejected: ["created", "cancelled"],
  in_transit: ["out_for_delivery", "exception", "delivery_failed", "returned", "cancelled"],
  out_for_delivery: ["delivered", "delivery_failed", "returned"],
  delivered: ["returned", "closed"],
  delivery_failed: ["in_transit", "exception", "closed", "returned"],
  returned: ["closed"],
  exception: ["created", "closed", "returned"],
  cancelled: ["closed"],
  closed: [],
};

/** Whether a transition from `from` to `to` is allowed by the shipment lifecycle's transition table. */
export function canTransitionShipment(from: ShipmentStatusValue, to: ShipmentStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Statuses a carrier walk may pass through on the way to its target (Ruling 23, amended in Task 1
 * fix round 1). `delivery_failed` is not here, so a late scan never invents a failure or walks
 * backwards; `label_created` is not here because a walk never starts from `created`. Both can
 * still be the walk's starting status.
 */
const WALKABLE = new Set<ShipmentStatusValue>([
  "carrier_accepted",
  "in_transit",
  "out_for_delivery",
]);

/** Targets reachable by walking; every other target (`cancelled`, `exception`, …) needs a direct edge. */
const WALK_TARGETS = new Set<ShipmentStatusValue>([
  "carrier_accepted",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returned",
]);

/**
 * Ruling 23: the shortest walk over the transition table from `from` to `to`, for carrier scans
 * that skip steps. Returns the steps after `from`, ending with `to`; `[]` when they are equal;
 * `null` when `to` is unreachable (the scan is then recorded without a status change).
 * A shipment in `created` has no live carrier delivery (never labelled, or voided and re-shipping
 * with the old tracking number still set), so no scan moves it: always `null`.
 */
export function carrierPathTo(
  from: ShipmentStatusValue,
  to: ShipmentStatusValue,
): readonly ShipmentStatusValue[] | null {
  if (from === "created") return null;
  if (from === to) return [];
  if (!WALK_TARGETS.has(to)) return canTransitionShipment(from, to) ? [to] : null;
  const previous = new Map<ShipmentStatusValue, ShipmentStatusValue>();
  const queue: ShipmentStatusValue[] = [from];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of TRANSITIONS[node]) {
      if (previous.has(next) || next === from) continue;
      if (next !== to && !WALKABLE.has(next)) continue;
      previous.set(next, node);
      if (next === to) {
        const path: ShipmentStatusValue[] = [to];
        for (let at = node; at !== from; at = previous.get(at)!) path.unshift(at);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Retry targets for the 3 recoverable states (`RetryShipment` use case). */
export const RETRY_TARGET_BY_STATUS: Readonly<
  Partial<Record<ShipmentStatusValue, ShipmentStatusValue>>
> = {
  rejected: "created",
  delivery_failed: "in_transit",
  exception: "created",
};

interface ShipmentStatusProps {
  readonly value: ShipmentStatusValue;
}

/** The lifecycle state of a shipment (a closed set of internal states; not external input). */
export class ShipmentStatus extends ValueObject<ShipmentStatusProps> {
  static created(): ShipmentStatus {
    return new ShipmentStatus({ value: "created" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: ShipmentStatusValue): ShipmentStatus {
    return new ShipmentStatus({ value });
  }

  get value(): ShipmentStatusValue {
    return this.props.value;
  }
}
