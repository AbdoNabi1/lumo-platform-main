import { Badge } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Order status → badge variant, covering the full 21-value lifecycle
 * (`services/orders/src/domain/order-event.ts`) — the Orders list/detail screens show the real
 * status, unlike the Dashboard widget's deliberately simplified 3-bucket mapping
 * (`src/data/recent-orders.ts`). Semantics: `success` = money/goods moved as expected, `warning`
 * = needs attention or mid-flight, `destructive` = failed/reversed, `info` = in progress,
 * `outline` = terminal and neutral (cancelled/closed), `neutral` = not yet started.
 */
const ORDER_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "accent" | "success" | "warning" | "destructive" | "info" | "outline">
> = {
  placed: "accent",
  paid: "success",
  refunded: "destructive",
  created: "neutral",
  confirmed: "info",
  cancelled: "outline",
  held: "warning",
  resumed: "info",
  awaiting_payment: "warning",
  payment_requested: "info",
  payment_received: "success",
  payment_failed: "destructive",
  ready_for_fulfillment: "info",
  fulfillment_requested: "info",
  fulfilled: "success",
  partially_fulfilled: "warning",
  delivered: "success",
  return_requested: "warning",
  returned: "warning",
  refund_requested: "warning",
  closed: "outline",
};

const PAYMENT_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "success" | "warning" | "destructive" | "info" | "outline">
> = {
  requires_payment: "warning",
  captured: "success",
  failed: "destructive",
  refunded: "destructive",
  created: "neutral",
  processing: "info",
  authorized: "info",
  capture_requested: "info",
  cancelled: "outline",
  expired: "outline",
  partially_refunded: "warning",
  closed: "outline",
};

export function OrderStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = ORDER_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.orderStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}

export function PaymentStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = PAYMENT_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.paymentStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}

const FULFILLMENT_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "accent" | "success" | "warning" | "destructive" | "info" | "outline">
> = {
  created: "neutral",
  reservation_requested: "info",
  confirmed: "info",
  failed: "destructive",
  picking_started: "info",
  picking_completed: "info",
  packing_started: "info",
  packing_completed: "info",
  shipment_created: "info",
  tracking_assigned: "info",
  shipment_dispatched: "info",
  in_transit: "info",
  out_for_delivery: "info",
  delivered: "success",
  delivery_failed: "destructive",
  returned: "warning",
  cancelled: "outline",
  closed: "outline",
};

const SHIPMENT_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "accent" | "success" | "warning" | "destructive" | "info" | "outline">
> = {
  created: "neutral",
  label_created: "info",
  voided: "outline",
  carrier_accepted: "info",
  rejected: "destructive",
  in_transit: "info",
  out_for_delivery: "info",
  delivered: "success",
  delivery_failed: "destructive",
  returned: "warning",
  exception: "destructive",
  cancelled: "outline",
  closed: "outline",
};

const RETURN_STATUS_VARIANT: Readonly<
  Record<string, "neutral" | "accent" | "success" | "warning" | "destructive" | "info" | "outline">
> = {
  requested: "neutral",
  approved: "info",
  rejected: "destructive",
  rma_generated: "info",
  package_received: "info",
  inspection_completed: "info",
  items_accepted: "success",
  items_rejected: "destructive",
  refund_requested: "warning",
  replacement_requested: "warning",
  repair_requested: "warning",
  closed: "outline",
};

export function FulfillmentStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = FULFILLMENT_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.fulfillmentStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}

export function ShipmentStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = SHIPMENT_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.shipmentStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}

export function ReturnStatusBadge({
  status,
  t,
}: {
  readonly status: string;
  readonly t: Dictionary;
}) {
  const variant = RETURN_STATUS_VARIANT[status] ?? "neutral";
  const label = (t.returnStatus as Record<string, string>)[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
