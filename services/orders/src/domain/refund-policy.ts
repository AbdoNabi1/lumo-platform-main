import type { OrderStatus } from "./order";

/**
 * The statuses an order may be refunded from: the legacy `paid`, and every status the checkout
 * lifecycle reaches AFTER the payment was received (G-127). Never one before it — there is nothing to
 * give back — and never `refunded`, `refund_requested`, `return_requested`, `cancelled` or `closed`.
 */
const REFUNDABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "paid",
  "payment_received",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "partially_fulfilled",
  "fulfilled",
  "delivered",
  "returned",
]);

/**
 * Decides whether an order may be refunded. Rule: only an order whose payment was received is
 * refundable (time-window and partial-refund policies are deferred). Stateless domain service.
 */
export class RefundPolicy {
  canRefund(status: OrderStatus): boolean {
    return REFUNDABLE.has(status);
  }
}
