import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ShipmentTransitioned } from "../domain/events/shipment-transitioned.event";

/** Maps Shipping domain events to integration events. `ShipmentTransitioned` carries its own canonical type (spanning `shipment`/`label`/`carrier`/`tracking` prefixes) — this translator is a pure pass-through, not a deriver. */
export class ShippingEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ShipmentTransitioned) {
      return {
        type: event.data.type,
        eventVersion: 1,
        aggregateType: "shipment",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Shipping context (validated fail-closed by `shippingModule()`), 15 types across the `shipment`/`label`/`carrier`/`tracking` prefixes. */
export const SHIPPING_PUBLISHED_EVENTS: readonly string[] = [
  "shipping.shipment.created",
  "shipping.shipment.in_transit",
  "shipping.shipment.out_for_delivery",
  "shipping.shipment.delivered",
  "shipping.shipment.delivery_failed",
  "shipping.shipment.returned",
  "shipping.shipment.exception",
  "shipping.shipment.cancelled",
  "shipping.shipment.closed",
  "shipping.label.created",
  "shipping.label.voided",
  "shipping.carrier.accepted",
  "shipping.carrier.rejected",
  "shipping.tracking.updated",
  "shipping.tracking.estimate_set",
];
