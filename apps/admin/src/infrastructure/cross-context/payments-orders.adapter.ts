import { logger } from "@platform/utils";
import type { OrderController } from "@platform/orders";
import type { OrdersPort } from "@platform/payments";

/**
 * Real `OrdersPort` for Payments' `reportPaymentOutcome` (Phase 3 Task 13, C-3) — fires for EVERY
 * payment intent status transition via `notifyBestEffort`
 * (`services/payments/src/application/payment-lifecycle.use-cases.ts`), including "captured".
 *
 * Deliberately NON-MUTATING (a firm design ruling, not an oversight — do not "upgrade" this to
 * call `markPaid`/`advance`/`refund`): Orders already has a completely separate, ASYNC path for
 * the "captured" case — `PaymentCapturedConsumer`
 * (`services/orders/src/interfaces/payment-captured.consumer.ts`) consumes the
 * `payments.payment_intent.captured` integration event and calls `MarkOrderPaid`. That file's own
 * doc comment states it is "the ONLY sanctioned producer of `orders.order.paid`/`payment_received`
 * besides admin backoffice action (doc 22 rule)." A synchronous `ordersPort` adapter that also
 * mutated order state on capture would be an unsanctioned THIRD producer of that same effect,
 * directly violating that documented invariant — regardless of whether the mutation would
 * technically be idempotent-safe at the domain level.
 *
 * So this adapter is "read, then log": it confirms `orderRef` is a real order via
 * `OrderController.getOrder`, then records the outcome through the structured logger. This is
 * observability, not a domain action — no order state is ever touched here.
 *
 * `NotificationPort`'s contract, and its one caller `notifyBestEffort`, already document this as
 * best-effort — "a reference-only notification failure never fails the intent's own transition" —
 * and `notifyBestEffort` already wraps the whole call in a swallowing try/catch. So, matching
 * `orders-payment.adapter.ts`'s failure-throw sections, this adapter does no local error handling
 * of its own: an order-not-found lookup failure propagates straight out and is swallowed by the
 * caller, exactly as designed.
 */
export class PaymentsOrdersAdapter implements OrdersPort {
  private readonly orders: Pick<OrderController, "getOrder">;

  constructor(orders: Pick<OrderController, "getOrder">) {
    this.orders = orders;
  }

  async reportPaymentOutcome(orderRef: string, status: string, tenantId: string): Promise<void> {
    const response = await this.orders.getOrder({ tenantId, orderId: orderRef });
    if (response.status >= 400) {
      logger.warn("PaymentsOrdersAdapter: order lookup failed for payment outcome", {
        orderRef,
        status,
        lookupStatus: response.status,
      });
      throw new Error(
        `PaymentsOrdersAdapter: getOrder failed for order "${orderRef}" ` +
          `(status ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }

    logger.info("PaymentsOrdersAdapter: payment outcome reported", { orderRef, status });
  }
}
