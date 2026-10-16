import type { PaymentVoidPort } from "@platform/orders";
import type { PaymentController } from "@platform/payments";
import { type Logger, logger as defaultLogger } from "@platform/utils";

/**
 * Real `PaymentVoidPort` (G-126): when staff cancel an order that was never paid, the payment intent
 * opened for it is cancelled too, so it cannot be authorized or collected against a dead order.
 *
 * It uses what Payments already has — the generic validated `AdvancePayment` transition
 * (`created -> cancelled`); no new Payments use case. That transition only changes the intent's own
 * state: nothing in Payments calls the provider's `cancel`. For cash on delivery that is exactly
 * right (`CashOnDeliveryProvider.cancel` is a no-op — nothing exists at any PSP). For a card it is
 * only right while the intent is still `created`, so ONLY `created` is cancelled here; an
 * `authorized` card keeps its hold at the PSP and is reported, not hidden (G-129), and an intent that
 * is captured, refunded, closed or already cancelled is left alone.
 *
 * Best-effort, never throws: the order is already cancelled when this runs. A problem is logged with
 * ids only — no name, phone, email or the PSP's message.
 */
export class OrdersPaymentVoidAdapter implements PaymentVoidPort {
  private readonly payments: Pick<PaymentController, "getPaymentIntent" | "advance">;
  private readonly logger: Logger;

  constructor(
    payments: Pick<PaymentController, "getPaymentIntent" | "advance">,
    logger: Logger = defaultLogger,
  ) {
    this.payments = payments;
    this.logger = logger;
  }

  async voidPayment(paymentRef: string, tenantId: string): Promise<void> {
    try {
      const found = await this.payments.getPaymentIntent({ tenantId, paymentIntentId: paymentRef });
      if (found.status !== 200) {
        this.logger.warn("OrdersPaymentVoidAdapter: could not read the payment to void", {
          paymentRef,
          status: found.status,
        });
        return;
      }
      const status = statusOf(found.body);
      if (status === "authorized") {
        this.logger.warn(
          "OrdersPaymentVoidAdapter: the payment is authorized at the provider and was not released (G-129)",
          { paymentRef },
        );
        return;
      }
      if (status !== "created") return;

      const voided = await this.payments.advance({
        tenantId,
        paymentIntentId: paymentRef,
        toStatus: "cancelled",
      });
      if (voided.status !== 200) {
        this.logger.warn("OrdersPaymentVoidAdapter: Payments refused to cancel the payment", {
          paymentRef,
          status: voided.status,
        });
      }
    } catch {
      this.logger.warn("OrdersPaymentVoidAdapter: voiding the payment failed", { paymentRef });
    }
  }
}

/** The intent entity's status is a value object (`status.value`); a plain string is accepted too. */
function statusOf(body: unknown): string | undefined {
  const status = (body as { status?: unknown } | null)?.status;
  if (typeof status === "string") return status;
  const value = (status as { value?: unknown } | null | undefined)?.value;
  return typeof value === "string" ? value : undefined;
}
