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

/** The validated lifecycle transition table (Sprint 4.9). */
const TRANSITIONS: Readonly<Record<FulfillmentStatusValue, readonly FulfillmentStatusValue[]>> = {
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

/** Whether a transition from `from` to `to` is allowed by the fulfillment lifecycle's transition table. */
export function canTransitionFulfillment(
  from: FulfillmentStatusValue,
  to: FulfillmentStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
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
