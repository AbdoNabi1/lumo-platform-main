import { afterEach, describe, expect, it } from "vitest";
import {
  fakeNotifier,
  fakeOrder,
  ordersReturning,
  spyLogger,
} from "./testing/notification-test-support";
import { PaymentsNotificationAdapter } from "./payments-notification.adapter";

const refund = (refundId: string, amountMinor: number) =>
  ({ kind: "refund_completed", refundId, amountMinor, currency: "EGP" }) as const;

/** Wave 2b: the refund mail; every other payment status says nothing (D41). */
describe("PaymentsNotificationAdapter", () => {
  let log: ReturnType<typeof spyLogger> | undefined;
  afterEach(() => log?.restore());

  it("a completed refund: one order_refunded, keyed by order and refund, with the amount", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new PaymentsNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    await adapter.notify("order-7", "partially_refunded", "t1", refund("rf-1", 35000));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      tenantId: "t1",
      template: "order_refunded",
      eventKey: "order-7:rf-1",
      recipientRef: "cust-1",
      variables: {
        order_number: "#1042",
        customer_ref: "cust-1",
        currency: "EGP",
        refund_minor: "35000",
      },
    });
  });

  it("two partial refunds are two events, each with its own key", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new PaymentsNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    await adapter.notify("order-7", "partially_refunded", "t1", refund("rf-1", 100));
    await adapter.notify("order-7", "partially_refunded", "t1", refund("rf-2", 200));
    expect(requests.map((r) => r.eventKey)).toEqual(["order-7:rf-1", "order-7:rf-2"]);
  });

  it("says nothing for any payment status without a refund event", async () => {
    expect.hasAssertions();
    const { notifier, requests } = fakeNotifier();
    const adapter = new PaymentsNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    for (const status of [
      "created",
      "processing",
      "authorized",
      "captured",
      "failed",
      "refunded",
      "voided",
    ]) {
      await adapter.notify("order-7", status, "t1");
    }
    expect(requests).toEqual([]);
  });

  it("sends nothing when the order cannot be read, and logs why without any address", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const { notifier, requests } = fakeNotifier();
    const adapter = new PaymentsNotificationAdapter(notifier, ordersReturning(null));
    await adapter.notify("order-7", "refunded", "t1", refund("rf-1", 100));
    expect(requests).toEqual([]);
    expect(log.dumped()).toContain("ORDER_NOT_FOUND");
  });

  it("never throws when the notifier does", async () => {
    expect.hasAssertions();
    log = spyLogger();
    const { notifier } = fakeNotifier({ throws: true });
    const adapter = new PaymentsNotificationAdapter(notifier, ordersReturning(fakeOrder()));
    await expect(
      adapter.notify("order-7", "refunded", "t1", refund("rf-1", 100)),
    ).resolves.toBeUndefined();
    expect(log.dumped()).not.toContain("a@b.test");
  });
});
