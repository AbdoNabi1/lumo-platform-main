/**
 * The three order events an ad platform is paid for (P2-D3, D4, D5): the purchase, its delivery and its
 * cancellation. Each is a server-origin envelope built from one {@link OrderTrackingReadModel}, ready to be published
 * as `tracking.event.captured.v1` and ingested like any other event.
 *
 * Ids (D5): the business id is the `dedupId` (`ord_<orderId>`, `dlv_<orderId>`, `cnl_<orderId>`), which is what Meta,
 * TikTok and Snap receive as their dedupe `event_id`. The envelope `eventId` is the UUID derived from the tenant and
 * that business id (`businessMessageId`), so a redelivered order event is the same outbox row and the same record.
 * `payload.orderId` is the order id in all three, which is GA4's `transaction_id`: a GA4 `refund` (the vendor name of
 * `order_cancelled`) references the purchase it reverses.
 *
 * The mappers are pure and deterministic: same read model, same envelope. They throw `RangeError` for an order id
 * that cannot be a business reference or a time that is not an instant (a malformed order, not a retryable fault).
 */

import type { LineItem } from "../envelope/payload";
import type { TrackingEnvelope } from "../envelope/envelope";
import { businessEventId, type BusinessEventKind } from "../ids/event-id";
import { contentIdOf } from "./content-id";
import {
  attributionContextOf,
  businessEnvelope,
  defined,
  e164Of,
  identityOf,
  instantOrThrow,
  pageContextOf,
  sessionContextOf,
  technicalContextOf,
} from "./envelope-parts";
import type {
  BusinessEventContext,
  OrderTrackingReadModel,
  TransitionEventContext,
} from "./order-read-model";
import { businessValueMinor } from "./value";

function lineItemsOf(order: OrderTrackingReadModel): readonly LineItem[] {
  return order.lines.map((line) => ({
    itemId: contentIdOf(line),
    ...defined({ sku: line.sku, name: line.name }),
    quantity: line.quantity,
    priceMinor: line.unitPriceMinor,
  }));
}

function orderEnvelope(
  order: OrderTrackingReadModel,
  context: BusinessEventContext,
  event: { readonly name: string; readonly kind: BusinessEventKind; readonly timestamp: string },
): TrackingEnvelope {
  const dedupId = businessEventId(event.kind, order.orderId);
  const snapshot = order.snapshot;
  const customer = order.customer;
  const shipping = order.shipping;
  const contents = lineItemsOf(order);
  const numItems = contents.reduce((total, line) => total + (line.quantity ?? 1), 0);

  const technical = technicalContextOf(snapshot);
  const session = sessionContextOf(snapshot);
  const attribution = attributionContextOf(snapshot);

  return businessEnvelope({
    tenantId: context.tenantId,
    eventName: event.name,
    dedupId,
    timestamp: event.timestamp,
    category: "commerce",
    context: {
      page: pageContextOf(snapshot, context.storeUrl, order.currency),
      ...(session === undefined ? {} : { session }),
      ...(technical === undefined ? {} : { technical }),
      ...(attribution === undefined ? {} : { attribution }),
      identity: identityOf({
        email: customer.email,
        phone: e164Of([customer.phone, shipping?.phone], order.currency),
        name: customer.name ?? shipping?.recipientName,
        customerId: customer.customerRef,
        visitorId: snapshot?.visitorId,
        sessionId: snapshot?.sessionId,
        city: shipping?.city,
        state: shipping?.province,
        country: shipping?.country,
      }),
    },
    payload: {
      valueMinor: businessValueMinor(order.totals),
      currency: order.currency,
      orderId: order.orderId,
      transactionId: order.orderId,
      taxMinor: order.totals.taxMinor,
      shippingMinor: order.totals.shippingMinor,
      discountMinor: order.totals.discountMinor,
      ...(order.couponCode === undefined ? {} : { coupon: order.couponCode }),
      numItems,
      contentIds: contents.map((line) => line.itemId),
      contentType: "product",
      contents,
    },
    ...(order.orderNumber === undefined ? {} : { properties: { orderNumber: order.orderNumber } }),
  });
}

/**
 * Purchase: `eventName: "purchase"`, `dedupId: ord_<orderId>`, event time = `order.placedAt`.
 * Built for `orders.order.created` (checkout/COD) and `orders.order.placed` (legacy admin orders) alike; the shared
 * id means whichever arrives second is a duplicate, never a second Purchase.
 */
export function purchaseEnvelope(
  order: OrderTrackingReadModel,
  context: BusinessEventContext,
): TrackingEnvelope {
  const timestamp = instantOrThrow(order.placedAt, "order.placedAt");
  return orderEnvelope(order, context, { name: "purchase", kind: "order", timestamp });
}

/** Delivered: `eventName: "order_delivered"`, `dedupId: dlv_<orderId>`, event time = `context.occurredAt`. */
export function deliveredEnvelope(
  order: OrderTrackingReadModel,
  context: TransitionEventContext,
): TrackingEnvelope {
  const timestamp = instantOrThrow(context.occurredAt, "context.occurredAt");
  return orderEnvelope(order, context, { name: "order_delivered", kind: "delivery", timestamp });
}

/**
 * Cancelled: `eventName: "order_cancelled"` (GA4 `refund`), `dedupId: cnl_<orderId>`, event time =
 * `context.occurredAt`. Built for `orders.order.cancelled` and `fulfillment.order.returned` alike (one id, so
 * both never double-send). The CALLER decides whether a cancel is worth sending (an `ord_` record must exist).
 */
export function cancelledEnvelope(
  order: OrderTrackingReadModel,
  context: TransitionEventContext,
): TrackingEnvelope {
  const timestamp = instantOrThrow(context.occurredAt, "context.occurredAt");
  return orderEnvelope(order, context, { name: "order_cancelled", kind: "cancel", timestamp });
}
