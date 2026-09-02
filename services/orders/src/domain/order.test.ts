import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, UniqueEntityId } from "@platform/domain";
import { Order } from "./order";
import { OrderItem } from "./order-item";
import { RefundPolicy } from "./refund-policy";
import { AddressSnapshot } from "./value-objects/address-snapshot";
import { OrderNumber } from "./value-objects/order-number";
import { OrderTotalsSnapshot } from "./value-objects/order-totals-snapshot";
import { ProductSnapshot } from "./value-objects/product-snapshot";

function line(id: string, amountMinor: number, quantity: number): OrderItem {
  const price = Money.create(amountMinor, "USD");
  if (!price.ok) throw new Error("invalid fixture");
  const snapshot = ProductSnapshot.create(id, `Product ${id}`, price.value);
  if (!snapshot.ok) throw new Error("invalid fixture");
  return OrderItem.create(UniqueEntityId.from(`item-${id}`), snapshot.value, quantity);
}

function address(): AddressSnapshot {
  const result = AddressSnapshot.create("1 Main St", "Town", "12345", "US");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function orderNumber(): OrderNumber {
  const result = OrderNumber.create("ORD-1");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function placedOrder(): Order {
  return Order.place(
    UniqueEntityId.from("order-1"),
    orderNumber(),
    "customer-1",
    "USD",
    [line("p1", 1000, 2), line("p2", 500, 1)],
    address(),
    "evt-place",
    new Date(0),
  );
}

describe("Order", () => {
  it("places an order, totals the lines, and emits order.placed", () => {
    const order = placedOrder();
    expect(order.status).toBe("placed");
    expect(order.totalAmount().amountMinor).toBe(2500);
    const events = order.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("order.placed");
  });

  it("rejects placing an order with no items", () => {
    expect(() =>
      Order.place(
        UniqueEntityId.from("order-2"),
        orderNumber(),
        "customer-1",
        "USD",
        [],
        address(),
        "evt",
        new Date(0),
      ),
    ).toThrow(BusinessRuleError);
  });

  it("transitions placed → paid → refunded, emitting events", () => {
    const order = placedOrder();
    order.pullDomainEvents();

    order.markPaid("payment-1", "evt-pay", new Date(0));
    expect(order.status).toBe("paid");
    expect(order.pullDomainEvents()[0]?.eventName).toBe("order.paid");

    order.refund(new RefundPolicy(), "evt-refund", new Date(0));
    expect(order.status).toBe("refunded");
    expect(order.pullDomainEvents()[0]?.eventName).toBe("order.refunded");
  });

  it("rejects refunding an unpaid order (RefundPolicy)", () => {
    const order = placedOrder();
    expect(() => order.refund(new RefundPolicy(), "evt", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects paying an order twice", () => {
    const order = placedOrder();
    order.markPaid("payment-1", "evt-pay", new Date(0));
    expect(() => order.markPaid("payment-2", "evt-pay-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("completePayment on a legacy 'placed' order delegates to markPaid, emitting order.paid", () => {
    const order = placedOrder();
    order.pullDomainEvents();

    order.completePayment("payment-1", "evt-pay", new Date(0));
    expect(order.status).toBe("paid");
    expect(order.pullDomainEvents()[0]?.eventName).toBe("order.paid");
  });

  it("completePayment on a checkout/saga order at payment_requested transitions to payment_received and records paymentRef, emitting order.transitioned", () => {
    const totals = OrderTotalsSnapshot.create({
      subtotalMinor: 1000,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 1000,
      currency: "USD",
    });
    const order = Order.createFromCheckout(
      UniqueEntityId.from("order-checkout-4"),
      orderNumber(),
      "customer-1",
      "USD",
      [line("p1", 1000, 1)],
      address(),
      address(),
      totals,
      "checkout-4",
      "evt-create",
      new Date(0),
    );
    order.confirm("evt-1", new Date(0));
    order.markAwaitingPayment("evt-2", new Date(0));
    order.requestPayment("payment-requested-ref", "evt-3", new Date(0));
    order.pullDomainEvents();

    order.completePayment("payment-captured-ref", "evt-4", new Date(0));
    expect(order.status).toBe("payment_received");
    expect(order.paymentRef).toBe("payment-captured-ref");
    expect(order.pullDomainEvents()[0]?.eventName).toBe("order.transitioned");
  });

  it("completePayment is idempotent-guarded: rejects an order already paid or already payment_received", () => {
    const legacy = placedOrder();
    legacy.completePayment("payment-1", "evt-pay", new Date(0));
    expect(() => legacy.completePayment("payment-2", "evt-pay-2", new Date(0))).toThrow(
      BusinessRuleError,
    );

    const totals = OrderTotalsSnapshot.create({
      subtotalMinor: 1000,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 1000,
      currency: "USD",
    });
    const saga = Order.createFromCheckout(
      UniqueEntityId.from("order-checkout-5"),
      orderNumber(),
      "customer-1",
      "USD",
      [line("p1", 1000, 1)],
      address(),
      address(),
      totals,
      "checkout-5",
      "evt-create",
      new Date(0),
    );
    saga.confirm("evt-1", new Date(0));
    saga.markAwaitingPayment("evt-2", new Date(0));
    saga.requestPayment("payment-requested-ref", "evt-3", new Date(0));
    saga.completePayment("payment-captured-ref", "evt-4", new Date(0));
    expect(() => saga.completePayment("payment-captured-ref-2", "evt-5", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("completePayment rejects a checkout/saga order too early in the lifecycle (e.g. still 'created')", () => {
    const totals = OrderTotalsSnapshot.create({
      subtotalMinor: 1000,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 1000,
      currency: "USD",
    });
    const order = Order.createFromCheckout(
      UniqueEntityId.from("order-checkout-6"),
      orderNumber(),
      "customer-1",
      "USD",
      [line("p1", 1000, 1)],
      address(),
      address(),
      totals,
      "checkout-6",
      "evt-create",
      new Date(0),
    );
    expect(() => order.completePayment("payment-1", "evt-pay", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("createFromCheckout starts at 'created' with billing address + totals snapshots", () => {
    const totals = OrderTotalsSnapshot.create({
      subtotalMinor: 2500,
      taxMinor: 100,
      shippingMinor: 500,
      discountMinor: 0,
      totalMinor: 3100,
      currency: "USD",
    });
    const order = Order.createFromCheckout(
      UniqueEntityId.from("order-checkout-1"),
      orderNumber(),
      "customer-1",
      "USD",
      [line("p1", 1000, 2), line("p2", 500, 1)],
      address(),
      address(),
      totals,
      "checkout-1",
      "evt-create",
      new Date(0),
    );
    expect(order.status).toBe("created");
    expect(order.checkoutRef).toBe("checkout-1");
    expect(order.totals?.totalMinor).toBe(3100);
    expect(order.totalAmount().amountMinor).toBe(3100);
  });

  it("runs the full lifecycle: created -> confirmed -> awaiting_payment -> payment_requested -> payment_received -> ready_for_fulfillment -> fulfillment_requested -> fulfilled -> delivered -> closed", () => {
    const totals = OrderTotalsSnapshot.create({
      subtotalMinor: 2500,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 2500,
      currency: "USD",
    });
    const order = Order.createFromCheckout(
      UniqueEntityId.from("order-checkout-2"),
      orderNumber(),
      "customer-1",
      "USD",
      [line("p1", 1000, 2), line("p2", 500, 1)],
      address(),
      address(),
      totals,
      "checkout-2",
      "evt-create",
      new Date(0),
    );

    order.confirm("evt-1", new Date(0));
    expect(order.status).toBe("confirmed");
    order.markAwaitingPayment("evt-2", new Date(0));
    expect(order.status).toBe("awaiting_payment");
    order.requestPayment("payment-ref-1", "evt-3", new Date(0));
    expect(order.status).toBe("payment_requested");
    expect(order.paymentRef).toBe("payment-ref-1");
    order.markPaymentReceived("evt-4", new Date(0));
    expect(order.status).toBe("payment_received");
    order.markReadyForFulfillment("evt-5", new Date(0));
    expect(order.status).toBe("ready_for_fulfillment");
    order.requestFulfillment("fulfillment-ref-1", "evt-6", new Date(0));
    expect(order.status).toBe("fulfillment_requested");
    expect(order.fulfillmentRef).toBe("fulfillment-ref-1");
    order.markFulfilled("evt-7", new Date(0));
    expect(order.status).toBe("fulfilled");
    order.markDelivered("evt-8", new Date(0));
    expect(order.status).toBe("delivered");
    order.close("evt-9", new Date(0));
    expect(order.status).toBe("closed");

    const events = order.pullDomainEvents();
    expect(events.filter((e) => e.eventName === "order.transitioned")).toHaveLength(10); // create + 9 transitions
  });

  it("rejects an illegal transition (e.g. created -> fulfilled directly, 409)", () => {
    const totals = OrderTotalsSnapshot.create({
      subtotalMinor: 1000,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 1000,
      currency: "USD",
    });
    const order = Order.createFromCheckout(
      UniqueEntityId.from("order-checkout-3"),
      orderNumber(),
      "customer-1",
      "USD",
      [line("p1", 1000, 1)],
      address(),
      address(),
      totals,
      "checkout-3",
      "evt-create",
      new Date(0),
    );
    expect(() => order.markFulfilled("evt-1", new Date(0))).toThrow(BusinessRuleError);
  });
});
