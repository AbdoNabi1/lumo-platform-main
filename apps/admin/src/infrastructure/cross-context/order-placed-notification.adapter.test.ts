import { afterEach, describe, expect, it } from "vitest";
import {
  fakeNotifier,
  fakeOrder,
  ordersReturning,
  spyLogger,
} from "./testing/notification-test-support";
import { OrderPlacedNotificationAdapter } from "./order-placed-notification.adapter";

/** Wave 2b: the confirmation and the staff mail when an order is placed. */
describe("OrderPlacedNotificationAdapter", () => {
  let log: ReturnType<typeof spyLogger> | undefined;
  afterEach(() => log?.restore());
  const placed = { tenantId: "t1", orderRef: "order-7", customerRef: "cust-1" };

  it("one confirmation for the customer and one staff mail request, both keyed by the order", async () => {
    expect.hasAssertions();
    const { notifier, requests, staffRequests } = fakeNotifier();
    await new OrderPlacedNotificationAdapter(notifier, ordersReturning(fakeOrder())).orderPlaced(
      placed,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      template: "order_confirmation",
      eventKey: "order-7",
      sourceRef: "orders:#1042",
      recipientRef: "cust-1",
      variables: { order_number: "#1042", total_minor: "95000", customer_ref: "cust-1" },
    });
    expect(staffRequests).toHaveLength(1);
    expect(staffRequests[0]).toMatchObject({ template: "staff_new_order", eventKey: "order-7" });
  });

  it("a failing confirmation does not stop the staff mail, and nothing is thrown", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const { notifier, staffRequests } = fakeNotifier({ throws: true });
    await expect(
      new OrderPlacedNotificationAdapter(notifier, ordersReturning(fakeOrder())).orderPlaced(
        placed,
      ),
    ).resolves.toBeUndefined();
    expect(staffRequests).toHaveLength(1);
    expect(log.dumped()).not.toContain("a@b.test");
  });

  it("sends nothing when the order cannot be read", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const { notifier, requests, staffRequests } = fakeNotifier();
    await new OrderPlacedNotificationAdapter(notifier, ordersReturning(null)).orderPlaced(placed);
    expect(requests).toEqual([]);
    expect(staffRequests).toEqual([]);
  });
});
