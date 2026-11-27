import type { OrderPlacedPort } from "@platform/checkout";
import type { Order, OrderController } from "@platform/orders";
import { orderMailVariables } from "./notification-mail-data";
import { guardedTrigger, type MailNotifier } from "./notification-trigger";

/**
 * Wave 2b: Checkout's `OrderPlacedPort` over the templated notifier. When an order is placed, ONE
 * `order_confirmation` goes to the customer and ONE `staff_new_order` to each staff recipient the store
 * configured. Each is its own trigger: one failing never stops the other, and neither can fail the
 * order (Checkout calls this after the commit, best effort, and this adapter swallows and logs too).
 *
 * Idempotency: `order_confirmation:<orderId>` and `staff_new_order:<orderId>:<recipient>`, so a repeat
 * announcement sends nothing new.
 */
export class OrderPlacedNotificationAdapter implements OrderPlacedPort {
  private readonly notifier: MailNotifier;
  private readonly orders: Pick<OrderController, "getOrder">;

  constructor(notifier: MailNotifier, orders: Pick<OrderController, "getOrder">) {
    this.notifier = notifier;
    this.orders = orders;
  }

  async orderPlaced(input: {
    readonly tenantId: string;
    readonly orderRef: string;
    readonly customerRef: string | undefined;
  }): Promise<void> {
    const { tenantId, orderRef } = input;
    let order: Order | null = null;
    await guardedTrigger("order_placed:read", { tenantId, orderRef }, async () => {
      const response = await this.orders.getOrder({ tenantId, orderId: orderRef });
      if (response.status !== 200) return { ok: false, error: { code: "ORDER_NOT_FOUND" } };
      order = response.body as Order;
    });
    if (order === null) return;
    const placed: Order = order;
    const variables = orderMailVariables(placed);
    const sourceRef = `orders:${variables["order_number"] ?? orderRef}`;

    await guardedTrigger("order_confirmation", { tenantId, orderRef }, () =>
      this.notifier.execute({
        tenantId,
        template: "order_confirmation",
        eventKey: orderRef,
        sourceRef,
        recipientRef: placed.customerRef,
        variables,
      }),
    );
    await guardedTrigger("staff_new_order", { tenantId, orderRef }, async () => {
      const results = await this.notifier.executeForStaff({
        tenantId,
        template: "staff_new_order",
        eventKey: orderRef,
        sourceRef,
        variables,
      });
      return results.find((result) => !result.ok);
    });
  }
}
