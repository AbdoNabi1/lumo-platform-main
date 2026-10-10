import type { OrderFulfillmentStatus } from "@platform/orders";

/**
 * Just the facts about a fulfillment order that the Shopify-style status needs — structurally what
 * `FulfillmentOrder` (`@platform/fulfillment`) exposes, so a real aggregate satisfies it.
 */
export interface FulfillmentFacts {
  readonly status: { readonly value: string };
  readonly deliveredAt?: Date | undefined;
  readonly trackingNumber?: { readonly value: string } | undefined;
}

/**
 * Fulfillment's real status values (the 18-value lifecycle in `services/fulfillment`) and the
 * Shopify-style status each one shows as. `closed` depends on what the order recorded, see below.
 */
export const FULFILLMENT_STATUS_MAPPING: readonly {
  readonly status: string;
  readonly shows: OrderFulfillmentStatus | "depends";
  readonly why: string;
}[] = [
  { status: "created", shows: "in_progress", why: "opened" },
  { status: "reservation_requested", shows: "in_progress", why: "reserving stock" },
  { status: "confirmed", shows: "in_progress", why: "stock reserved" },
  { status: "failed", shows: "unfulfilled", why: "the reservation failed; nothing is moving" },
  { status: "picking_started", shows: "in_progress", why: "picking" },
  { status: "picking_completed", shows: "in_progress", why: "picked" },
  { status: "packing_started", shows: "in_progress", why: "packing" },
  { status: "packing_completed", shows: "in_progress", why: "packed" },
  { status: "shipment_created", shows: "in_progress", why: "shipment prepared, not yet shipped" },
  { status: "tracking_assigned", shows: "in_progress", why: "label ready, not yet shipped" },
  { status: "shipment_dispatched", shows: "fulfilled", why: "handed to the carrier" },
  { status: "in_transit", shows: "fulfilled", why: "shipped" },
  { status: "out_for_delivery", shows: "fulfilled", why: "shipped" },
  { status: "delivered", shows: "delivered", why: "arrived" },
  {
    status: "delivery_failed",
    shows: "fulfilled",
    why: "it was shipped; the delivery attempt failed",
  },
  {
    status: "returned",
    shows: "fulfilled",
    why: "it was shipped; the return is tracked elsewhere",
  },
  { status: "cancelled", shows: "unfulfilled", why: "cancelled" },
  {
    status: "closed",
    shows: "depends",
    why: "delivered / shipped / never shipped, see the record",
  },
];

const BY_STATUS = new Map(FULFILLMENT_STATUS_MAPPING.map((row) => [row.status, row.shows]));

/**
 * Shopify's fulfillment status for an order, from the Fulfillment context's fulfillment order for it
 * (`undefined` when none was opened). Pure, and independent of payment: a cash-on-delivery order can
 * be fulfilled while its payment is still pending.
 *
 * `closed` is the terminal state after delivery, a return, a failed delivery OR a cancellation, so on
 * its own it is ambiguous: delivered when `deliveredAt` is set, fulfilled when a tracking number says
 * it shipped, otherwise it never shipped. A status this table does not know reads as `in_progress`,
 * never as shipped.
 */
export function deriveFulfillmentStatus(
  fulfillmentOrder: FulfillmentFacts | undefined,
): OrderFulfillmentStatus {
  if (fulfillmentOrder === undefined) return "unfulfilled";
  const shows = BY_STATUS.get(fulfillmentOrder.status.value);
  if (shows === undefined) return "in_progress";
  if (shows !== "depends") return shows;
  if (fulfillmentOrder.deliveredAt !== undefined) return "delivered";
  if (fulfillmentOrder.trackingNumber !== undefined) return "fulfilled";
  return "unfulfilled";
}
