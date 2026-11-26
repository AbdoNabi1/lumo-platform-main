import type { OrderController } from "@platform/orders";
import type { Order } from "@platform/orders";
import type { NotificationPort } from "@platform/orders";
import { orderMailVariables } from "./notification-mail-data";
import { guardedTrigger, type MailNotifier, type UnannouncedOrders } from "./notification-trigger";

/**
 * Wave 2b: Orders' `NotificationPort` over the templated notifier. It replaces the old generic
 * "Order {{orderNumber}} status changed to {{status}}" mail (D41): only ONE order transition mails the
 * customer from here, the cancellation (`order_canceled`). Every other status says nothing: the order
 * confirmation is sent once when the order is placed (Checkout's `OrderPlacedPort`), and shipping and
 * refund mails come from Fulfillment and Payments.
 *
 * `notify` is called from inside the transition and is documented best-effort (the caller swallows
 * everything); this adapter swallows and logs too, so the cancellation can never fail or roll back
 * because of a mail (D42). The notification's idempotency key is `order_canceled:<orderId>`: a
 * settle retry that notifies again mails nothing.
 *
 * An order Checkout placed and then undid for lack of stock was never announced, so its cancellation is
 * not mailed either (`UnannouncedOrders`).
 */
export class OrdersNotificationAdapter implements NotificationPort {
  private readonly notifier: MailNotifier;
  private readonly orders: Pick<OrderController, "getOrder">;
  private readonly unannounced: UnannouncedOrders | undefined;

  /** ADR-0014: stateless per tenant, `notify` carries `tenantId` per call. */
  constructor(
    notifier: MailNotifier,
    orders: Pick<OrderController, "getOrder">,
    unannounced?: UnannouncedOrders,
  ) {
    this.notifier = notifier;
    this.orders = orders;
    this.unannounced = unannounced;
  }

  async notify(
    customerRef: string,
    orderNumber: string,
    status: string,
    tenantId: string,
    orderId?: string,
  ): Promise<void> {
    if (status !== "cancelled") return;
    if (orderId !== undefined && this.unannounced?.has(orderId) === true) return;
    await guardedTrigger(
      "order_canceled",
      { tenantId, orderRef: orderId ?? orderNumber },
      async () => {
        const variables = await this.variablesFor(orderId, orderNumber, tenantId);
        return this.notifier.execute({
          tenantId,
          template: "order_canceled",
          eventKey: orderId ?? orderNumber,
          sourceRef: `orders:${orderNumber}`,
          recipientRef: customerRef,
          variables,
        });
      },
    );
  }

  /** The order's lines and totals when it can be read; the bare order number when it cannot. */
  private async variablesFor(
    orderId: string | undefined,
    orderNumber: string,
    tenantId: string,
  ): Promise<Record<string, string>> {
    if (orderId !== undefined) {
      try {
        const response = await this.orders.getOrder({ tenantId, orderId });
        if (response.status === 200) return orderMailVariables(response.body as Order);
      } catch {
        // fall through to the bare number
      }
    }
    return { order_number: orderNumber };
  }
}
