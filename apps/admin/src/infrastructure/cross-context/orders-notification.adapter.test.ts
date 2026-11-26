import { afterEach, describe, expect, it } from "vitest";
import {
  fakeNotifier,
  fakeOrder,
  ordersReturning,
  spyLogger,
} from "./testing/notification-test-support";
import { UnannouncedOrders } from "./notification-trigger";
import { OrdersNotificationAdapter } from "./orders-notification.adapter";

/** Wave 2b: the order cancellation mail; every other order status says nothing (D41). */
describe("OrdersNotificationAdapter", () => {
  let log: ReturnType<typeof spyLogger> | undefined;
  afterEach(() => log?.restore());

  it("cancelled: one order_canceled for the customer, keyed by the order id, with the order's facts", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new OrdersNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    await adapter.notify("cust-1", "#1042", "cancelled", "t1", "order-7");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      tenantId: "t1",
      template: "order_canceled",
      eventKey: "order-7",
      sourceRef: "orders:#1042",
      recipientRef: "cust-1",
      variables: {
        order_number: "#1042",
        currency: "EGP",
        total_minor: "95000",
        customer_ref: "cust-1",
      },
    });
    // The raw product name is stored; it is HTML-escaped only when the mail is rendered.
    expect(requests[0]?.variables["order_json"]).toContain("<script>");
    expect(JSON.stringify(requests[0])).not.toContain("@");
  });

  it("says nothing for every other status: the generic 'status changed' mail is gone", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new OrdersNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    for (const status of [
      "created",
      "confirmed",
      "awaiting_payment",
      "payment_requested",
      "payment_received",
      "ready_for_fulfillment",
      "fulfillment_requested",
      "fulfilled",
      "delivered",
      "paid",
      "refunded",
      "closed",
    ]) {
      await adapter.notify("cust-1", "#1042", status, "t1", "order-7");
    }
    expect(requests).toEqual([]);
  });

  it("does not mail the cancellation of an order Checkout placed and undid (never announced)", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const unannounced = new UnannouncedOrders();
    const adapter = new OrdersNotificationAdapter(
      notifier,
      ordersReturning(fakeOrder()),
      unannounced,
    );
    unannounced.mark("order-7");
    await adapter.notify("cust-1", "#1042", "cancelled", "t1", "order-7");
    expect(requests).toEqual([]);
    unannounced.clear("order-7");
    await adapter.notify("cust-1", "#1042", "cancelled", "t1", "order-7");
    expect(requests).toHaveLength(1);
  });

  it("falls back to the bare order number when the order cannot be read", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new OrdersNotificationAdapter(notifier, ordersReturning(null));
    await adapter.notify("cust-1", "#1042", "cancelled", "t1", "order-7");
    expect(requests[0]?.variables).toEqual({ order_number: "#1042" });
  });

  it("never throws; a failing or refusing notifier is logged with a short reason, no address", async () => {
    expect.hasAssertions();
    log = spyLogger();
    for (const options of [{ throws: true }, { refuses: true }]) {
      const { notifier } = fakeNotifier(options);
      const adapter = new OrdersNotificationAdapter(notifier, ordersReturning(fakeOrder()));
      await expect(
        adapter.notify("cust-1", "#1042", "cancelled", "t1", "order-7"),
      ).resolves.toBeUndefined();
    }
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.dumped()).not.toContain("a@b.test");
    expect(log.dumped()).toContain("order_canceled");
  });
});
