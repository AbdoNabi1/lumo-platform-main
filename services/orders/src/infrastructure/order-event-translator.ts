import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { OrderPaid } from "../domain/events/order-paid.event";
import { OrderPlaced } from "../domain/events/order-placed.event";
import { OrderRefunded } from "../domain/events/order-refunded.event";
import { OrderTransitioned } from "../domain/events/order-transitioned.event";

/** Maps Orders domain events to integration events. `OrderTransitioned` maps to the canonical `orders.order.<status>` type dynamically. */
export class OrderEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof OrderPlaced) {
      return {
        type: "orders.order.placed",
        eventVersion: 1,
        aggregateType: "order",
        payload: event.data,
      };
    }
    if (event instanceof OrderPaid) {
      return {
        type: "orders.order.paid",
        eventVersion: 1,
        aggregateType: "order",
        payload: event.data,
      };
    }
    if (event instanceof OrderRefunded) {
      return {
        type: "orders.order.refunded",
        eventVersion: 1,
        aggregateType: "order",
        payload: event.data,
      };
    }
    if (event instanceof OrderTransitioned) {
      return {
        type: `orders.order.${event.data.toStatus}`,
        eventVersion: 1,
        aggregateType: "order",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Orders context (validated fail-closed by `ordersModule()`), 21 types: legacy 3 + the full lifecycle's 18. */
export const ORDERS_PUBLISHED_EVENTS: readonly string[] = [
  "orders.order.placed",
  "orders.order.paid",
  "orders.order.refunded",
  "orders.order.created",
  "orders.order.confirmed",
  "orders.order.cancelled",
  "orders.order.held",
  "orders.order.resumed",
  "orders.order.awaiting_payment",
  "orders.order.payment_requested",
  "orders.order.payment_received",
  "orders.order.payment_failed",
  "orders.order.ready_for_fulfillment",
  "orders.order.fulfillment_requested",
  "orders.order.fulfilled",
  "orders.order.partially_fulfilled",
  "orders.order.delivered",
  "orders.order.return_requested",
  "orders.order.returned",
  "orders.order.refund_requested",
  "orders.order.closed",
];
