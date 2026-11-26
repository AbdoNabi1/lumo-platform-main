import { afterEach, describe, expect, it } from "vitest";
import { FulfillmentNotificationAdapter } from "./fulfillment-notification.adapter";
import {
  fakeNotifier,
  fakeOrder,
  ordersReturning,
  spyLogger,
} from "./testing/notification-test-support";

const detail = { fulfillmentOrderId: "ff-1", trackingNumber: "5108002", carrier: "bosta" };

/** Wave 2b: the shipping confirmation, once per shipment. */
describe("FulfillmentNotificationAdapter", () => {
  let log: ReturnType<typeof spyLogger> | undefined;
  afterEach(() => log?.restore());

  it("tracking assigned: one shipping_confirmation with tracking number and carrier", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new FulfillmentNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    await adapter.notify("order-7", "tracking_assigned", "t1", detail);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      tenantId: "t1",
      template: "shipping_confirmation",
      eventKey: "ff-1:5108002",
      recipientRef: "cust-1",
      variables: {
        order_number: "#1042",
        tracking_number: "5108002",
        carrier: "bosta",
        customer_ref: "cust-1",
      },
    });
  });

  it("tracking_assigned and shipment_dispatched share one key, so the second is deduplicated downstream", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new FulfillmentNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    await adapter.notify("order-7", "tracking_assigned", "t1", detail);
    await adapter.notify("order-7", "shipment_dispatched", "t1", detail);
    expect(new Set(requests.map((r) => `${r.template}:${r.eventKey}`)).size).toBe(1);
    // A re-labelled shipment is a new shipment.
    await adapter.notify("order-7", "tracking_assigned", "t1", {
      ...detail,
      trackingNumber: "999",
    });
    expect(requests.at(-1)?.eventKey).toBe("ff-1:999");
  });

  it("says nothing for any other fulfilment status, or without detail", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new FulfillmentNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    for (const status of [
      "created",
      "reservation_requested",
      "confirmed",
      "picking_started",
      "packing_completed",
      "shipment_created",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ]) {
      await adapter.notify("order-7", status, "t1", detail);
    }
    await adapter.notify("order-7", "tracking_assigned", "t1");
    expect(requests).toEqual([]);
  });

  it("sends nothing and never throws when the order is missing or the notifier fails", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const missing = fakeNotifier();
    await new FulfillmentNotificationAdapter(missing.notifier, ordersReturning(null)).notify(
      "order-7",
      "tracking_assigned",
      "t1",
      detail,
    );
    expect(missing.requests).toEqual([]);
    const failing = fakeNotifier({ throws: true });
    await expect(
      new FulfillmentNotificationAdapter(failing.notifier, ordersReturning(fakeOrder())).notify(
        "order-7",
        "tracking_assigned",
        "t1",
        detail,
      ),
    ).resolves.toBeUndefined();
    expect(log.dumped()).not.toContain("a@b.test");
  });
});
