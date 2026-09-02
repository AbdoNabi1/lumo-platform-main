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

/** The validated lifecycle transition table (Sprint 4.10). Recoverable states (`rejected`/`delivery_failed`/`exception`) can retry forward. */
const TRANSITIONS: Readonly<Record<ShipmentStatusValue, readonly ShipmentStatusValue[]>> = {
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

/** Whether a transition from `from` to `to` is allowed by the shipment lifecycle's transition table. */
export function canTransitionShipment(from: ShipmentStatusValue, to: ShipmentStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
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
