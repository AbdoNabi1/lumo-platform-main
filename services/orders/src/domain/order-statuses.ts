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

/** The events that make an order "paid" — exported so SQL predicates use exactly what {@link derivePaymentStatus} reads. */
export const PAID_EVENT_TYPES: readonly OrderEventType[] = ["paid", "payment_received"];
const PAID: ReadonlySet<OrderEventType> = new Set<OrderEventType>(PAID_EVENT_TYPES);

/**
 * The events that make an order "refunded" (full refunds only). Exported so the sales read model's
 * SQL counts exactly what {@link derivePaymentStatus} calls refunded: one definition.
 */
export const REFUNDED_EVENT_TYPES: readonly OrderEventType[] = ["refunded", "refund_requested"];
const REFUNDED: ReadonlySet<OrderEventType> = new Set<OrderEventType>(REFUNDED_EVENT_TYPES);

/** The event that makes an order "cancelled" for good, even if it is closed afterwards. */
export const CANCELLED_EVENT_TYPE: OrderEventType = "cancelled";

/** The terminal event: nothing follows it in the lifecycle, so having it means the order is closed. */
export const CLOSED_EVENT_TYPE: OrderEventType = "closed";

/** An order is open ({@link isOpenOrder}) exactly while its history holds none of these. */
export const NOT_OPEN_EVENT_TYPES: readonly OrderEventType[] = [
  CANCELLED_EVENT_TYPE,
  CLOSED_EVENT_TYPE,
];

/**
 * An order's payment is "pending" ({@link derivePaymentStatus}) exactly while its history holds none of
 * these: the list's Unpaid tab is a `NOT EXISTS` over them, so the tab and the badge cannot disagree.
 */
export const PAYMENT_DECIDED_EVENT_TYPES: readonly OrderEventType[] = [
  ...PAID_EVENT_TYPES,
  ...REFUNDED_EVENT_TYPES,
  CANCELLED_EVENT_TYPE,
];

/**
 * The event every order starts with — `placed` (legacy `Order.place`) or `created` (checkout). Its time
 * is when the order was placed: the list's `createdAt` and the export's date filter.
 */
export const ORDER_ENTRY_EVENT_TYPES: readonly OrderEventType[] = ["placed", "created"];

/**
 * Whether an order can still need fulfilling: it was never cancelled and is not closed. The one
 * definition behind the dashboard's "orders to fulfill" and the orders list's unfulfilled filter
 * (the sales read model's SQL asks for exactly these two event types).
 */
export function isOpenOrder(history: readonly { readonly type: OrderEventType }[]): boolean {
  return !history.some(
    (entry) => entry.type === CANCELLED_EVENT_TYPE || entry.type === CLOSED_EVENT_TYPE,
  );
}

/** Pure: the payment status an order's append-only history implies. */
export function derivePaymentStatus(
  history: readonly { readonly type: OrderEventType }[],
): OrderPaymentStatus {
  const types = history.map((entry) => entry.type);
  if (types.some((type) => REFUNDED.has(type))) return "refunded";
  if (types.some((type) => PAID.has(type))) return "paid";
  if (types.includes(CANCELLED_EVENT_TYPE)) return "voided";
  return "pending";
}
