import type { OrderStatus } from "./order";

/**
 * Decides whether an order may be refunded. Phase-1 rule: only a **paid** order is refundable
 * (time-window and partial-refund policies are deferred). Stateless domain service.
 */
export class RefundPolicy {
  canRefund(status: OrderStatus): boolean {
    return status === "paid";
  }
}
