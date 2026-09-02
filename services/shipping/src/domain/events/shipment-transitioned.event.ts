import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { ShipmentStatusValue } from "../value-objects/shipment-status";

export interface ShipmentTransitionedData {
  readonly shipmentRef: string;
  /** The canonical 3-segment integration-event type this occurrence carries (e.g. `shipping.label.created`, `shipping.tracking.updated`) — the translator is a pure pass-through of this field, not a deriver of it (Sprint 4.10's event taxonomy spans `shipment`/`label`/`carrier`/`tracking` prefixes, not one uniform `<status>` mapping). */
  readonly type: string;
  readonly fromStatus: ShipmentStatusValue;
  readonly toStatus: ShipmentStatusValue;
}

/** Raised on every lifecycle occurrence — a validated status transition, or a non-status-changing tracking/estimate update (in which case `fromStatus === toStatus`). The translator maps this to the `type` it carries. */
export class ShipmentTransitioned extends DomainEvent {
  readonly eventName = "shipment.transitioned";
  readonly data: ShipmentTransitionedData;

  constructor(props: DomainEventProps, data: ShipmentTransitionedData) {
    super(props);
    this.data = data;
  }
}
