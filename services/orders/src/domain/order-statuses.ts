import type { OrderEventType } from "./order-event";

/**
 * Shopify's payment status, DERIVED from an order's history — never stored (like the order status
 * itself). `refunded` wins over `paid` (a refunded order was paid first); `voided` is an order that
 * was cancelled before any payment arrived.
 */
export type OrderPaymentStatus = "pending" | "paid" | "refunded" | "voided";

/**
 * Shopify's fulfillment status, derived from the Fulfillment context's fulfillment order for the
 * order (see `deriveFulfillmentStatus` in `apps/admin`). Independent of payment, as in Shopify: a
 * cash-on-delivery order can be fulfilled while its payment is still pending.
 */
export type OrderFulfillmentStatus = "unfulfilled" | "in_progress" | "fulfilled" | "delivered";

const PAID: ReadonlySet<OrderEventType> = new Set<OrderEventType>(["paid", "payment_received"]);
const REFUNDED: ReadonlySet<OrderEventType> = new Set<OrderEventType>([
  "refunded",
  "refund_requested",
]);

/** Pure: the payment status an order's append-only history implies. */
export function derivePaymentStatus(
  history: readonly { readonly type: OrderEventType }[],
): OrderPaymentStatus {
  const types = history.map((entry) => entry.type);
  if (types.some((type) => REFUNDED.has(type))) return "refunded";
  if (types.some((type) => PAID.has(type))) return "paid";
  if (types.includes("cancelled")) return "voided";
  return "pending";
}
