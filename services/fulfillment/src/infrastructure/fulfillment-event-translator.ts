import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { FulfillmentTransitioned } from "../domain/events/fulfillment-transitioned.event";

/** Maps Fulfillment domain events to integration events. `FulfillmentTransitioned` maps dynamically to its canonical `fulfillment.order.<status>` type. */
export class FulfillmentEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof FulfillmentTransitioned) {
      return {
        type: `fulfillment.order.${event.data.toStatus}`,
        eventVersion: 1,
        aggregateType: "fulfillment_order",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Fulfillment context (validated fail-closed by `fulfillmentModule()`), 18 types — one per `FulfillmentStatusValue`. */
export const FULFILLMENT_PUBLISHED_EVENTS: readonly string[] = [
  "fulfillment.order.created",
  "fulfillment.order.reservation_requested",
  "fulfillment.order.confirmed",
  "fulfillment.order.failed",
  "fulfillment.order.picking_started",
  "fulfillment.order.picking_completed",
  "fulfillment.order.packing_started",
  "fulfillment.order.packing_completed",
  "fulfillment.order.shipment_created",
  "fulfillment.order.tracking_assigned",
  "fulfillment.order.shipment_dispatched",
  "fulfillment.order.in_transit",
  "fulfillment.order.out_for_delivery",
  "fulfillment.order.delivered",
  "fulfillment.order.delivery_failed",
  "fulfillment.order.returned",
  "fulfillment.order.cancelled",
  "fulfillment.order.closed",
];
