import type { IntegrationEvent } from "@platform/domain-events";
import type { EventHandler } from "@platform/messaging";
import type { Logger } from "@platform/utils";
import type { MarkOrderPaid } from "../application/mark-order-paid.use-case";

/** Payload of `payments.payment_intent.captured.v1` (doc 20 §1.1; produced by Payments). */
export interface PaymentCapturedPayload {
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface PaymentCapturedConsumerDeps {
  readonly markOrderPaid: MarkOrderPaid;
  readonly logger: Logger;
  /**
   * ADR-0014 (WP-10, T10.3): `MarkOrderPaid` takes `tenantId` per call. Until `tenantId` is required
   * on the event envelope (G-64 — a contract change, out of scope here) the composition root
   * supplies it, exactly as the other event consumers in `apps/runtime` do; reading the envelope
   * tenant per message is the separate G-64 fix.
   */
  readonly tenantId: string;
}

/**
 * The first real cross-context flow (Sprint 2.5, doc 22): `payments.payment_intent.captured` →
 * `MarkOrderPaid`. Payment truth is never caller-asserted — this consumer is the ONLY sanctioned
 * producer of `orders.order.paid`/`payment_received` besides admin backoffice action (doc 22 rule).
 * It goes through the application layer exclusively; the aggregate is never touched directly.
 *
 * Idempotency & failure semantics (at-least-once delivery):
 * - Order already `paid` (legacy) or already `payment_received` (checkout/saga lifecycle, Sprint A1
 *   — Payment Truth Foundation) → SUCCESS (duplicate delivery that slipped past the inbox — the
 *   effect already holds). Detected via `Order.completePayment`'s own transition-error message for
 *   either terminal-for-payment status.
 * - Order not found → THROW (retryable): `order.placed` and the capture may race across
 *   contexts; the retry schedule absorbs the ordering gap.
 * - Any other business-rule violation (e.g. capture arriving after refund) → THROW: a genuine
 *   anomaly that must surface in the DLQ for operator triage, never silently swallowed.
 */
export class PaymentCapturedConsumer implements EventHandler<PaymentCapturedPayload> {
  readonly eventType = "payments.payment_intent.captured";
  readonly eventVersion = 1;
  private readonly deps: PaymentCapturedConsumerDeps;

  constructor(deps: PaymentCapturedConsumerDeps) {
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<PaymentCapturedPayload>): Promise<void> {
    const result = await this.deps.markOrderPaid.execute({
      tenantId: this.deps.tenantId,
      orderId: event.payload.orderRef,
      paymentRef: event.aggregateId, // the payment intent id
    });
    if (result.ok) {
      return;
    }

    // Duplicate effect: the order is already paid (legacy) or already payment_received (checkout/
    // saga) — idempotent success, not an error. (Pinned by unit tests; the message is
    // `Order.completePayment`'s own guard for either terminal-for-payment status.)
    if (
      result.error.code === "BUSINESS_RULE" &&
      (result.error.message.includes('from status "paid"') ||
        result.error.message.includes('from status "payment_received"'))
    ) {
      this.deps.logger.info("payment.captured duplicate — order already paid", {
        orderId: event.payload.orderRef,
        messageId: event.messageId,
      });
      return;
    }

    // NotFound (cross-context race) and genuine anomalies (e.g. refunded) both throw:
    // the runtime retries with backoff and dead-letters on exhaustion.
    throw result.error;
  }
}
