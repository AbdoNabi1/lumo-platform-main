import type {
  FulfillmentNotificationDetail,
  FulfillmentNotificationPort,
} from "@platform/fulfillment";
import type { Order, OrderController } from "@platform/orders";
import { guardedTrigger, type MailNotifier } from "./notification-trigger";

/** The fulfilment statuses at which a parcel has a tracking number and counts as shipped. */
const SHIPPED_STATUSES: ReadonlySet<string> = new Set(["tracking_assigned", "shipment_dispatched"]);

/**
 * Wave 2b: Fulfillment's `NotificationPort` over the templated notifier: the customer's "your order is
 * on its way" mail (`shipping_confirmation`), with the tracking number when there is one.
 *
 * ONE mail per shipment: a fulfillment passes `tracking_assigned` and then `shipment_dispatched` with
 * the same tracking number, and both reach here, so the idempotency key is
 * `<fulfillment order>:<tracking number>`. The first to arrive mails; the second finds the notification
 * and does nothing. Re-attaching a different label later (a new tracking number) is a new shipment and
 * mails again. Every other fulfilment status says nothing to the customer.
 *
 * No tracking URL is built: no carrier in this codebase exposes one, so `{{tracking_url}}` renders empty
 * until that exists. `orderRef` is the order id.
 */
export class FulfillmentNotificationAdapter implements FulfillmentNotificationPort {
  private readonly notifier: MailNotifier;
  private readonly orders: Pick<OrderController, "getOrder">;

  constructor(notifier: MailNotifier, orders: Pick<OrderController, "getOrder">) {
    this.notifier = notifier;
    this.orders = orders;
  }

  async notify(
    orderRef: string,
    status: string,
    tenantId: string,
    detail?: FulfillmentNotificationDetail,
  ): Promise<void> {
    if (!SHIPPED_STATUSES.has(status) || detail === undefined) return;
    await guardedTrigger("shipping_confirmation", { tenantId, orderRef }, async () => {
      const response = await this.orders.getOrder({ tenantId, orderId: orderRef });
      if (response.status !== 200) return { ok: false, error: { code: "ORDER_NOT_FOUND" } };
      const order = response.body as Order;
      return this.notifier.execute({
        tenantId,
        template: "shipping_confirmation",
        eventKey: `${detail.fulfillmentOrderId}:${detail.trackingNumber ?? "shipped"}`,
        sourceRef: `fulfillment:${order.orderNumber.value}`,
        recipientRef: order.customerRef,
        variables: {
          order_number: order.orderNumber.value,
          customer_ref: order.customerRef,
          ...(detail.trackingNumber === undefined
            ? {}
            : { tracking_number: detail.trackingNumber }),
          ...(detail.carrier === undefined ? {} : { carrier: detail.carrier }),
        },
      });
    });
  }
}
