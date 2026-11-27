import type { Order, OrderController } from "@platform/orders";
import type { NotificationPort, PaymentNotificationEvent } from "@platform/payments";
import { orderMailVariables } from "./notification-mail-data";
import { guardedTrigger, type MailNotifier } from "./notification-trigger";

/**
 * Wave 2b: Payments' `NotificationPort` over the templated notifier. It replaces the generic "Payment
 * for order X status changed to Y" mail (D41): the only thing mailed from here is a COMPLETED REFUND
 * (`order_refunded`), once per refund (the refund id is the event, so two partial refunds are two
 * mails and a replayed settle is none). Every other payment status says nothing to the customer.
 *
 * `orderRef` is the order id. The order is read to learn its customer, number and currency. Called
 * best-effort from the settle step; this adapter swallows and logs too (D42).
 */
export class PaymentsNotificationAdapter implements NotificationPort {
  private readonly notifier: MailNotifier;
  private readonly orders: Pick<OrderController, "getOrder">;

  constructor(notifier: MailNotifier, orders: Pick<OrderController, "getOrder">) {
    this.notifier = notifier;
    this.orders = orders;
  }

  async notify(
    orderRef: string,
    _status: string,
    tenantId: string,
    event?: PaymentNotificationEvent,
  ): Promise<void> {
    if (event?.kind !== "refund_completed") return;
    await guardedTrigger("order_refunded", { tenantId, orderRef }, async () => {
      const response = await this.orders.getOrder({ tenantId, orderId: orderRef });
      if (response.status !== 200) return { ok: false, error: { code: "ORDER_NOT_FOUND" } };
      const order = response.body as Order;
      const variables = orderMailVariables(order);
      return this.notifier.execute({
        tenantId,
        template: "order_refunded",
        eventKey: `${orderRef}:${event.refundId}`,
        sourceRef: `payments:${variables["order_number"] ?? orderRef}`,
        recipientRef: order.customerRef,
        variables: {
          order_number: variables["order_number"] ?? "",
          customer_ref: order.customerRef,
          currency: event.currency,
          refund_minor: String(event.amountMinor),
        },
      });
    });
  }
}
