import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { IntegrationEvent } from "@platform/domain-events";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { NotFoundError, type Logger } from "@platform/utils";
import { Money, UniqueEntityId } from "@platform/domain";
import { MarkOrderPaid } from "../application/mark-order-paid.use-case";
import { PlaceOrder } from "../application/place-order.use-case";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { OrderTotalsSnapshot } from "../domain/value-objects/order-totals-snapshot";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import { PaymentCapturedConsumer, type PaymentCapturedPayload } from "./payment-captured.consumer";

const clock: Clock = { now: () => new Date("2026-07-05T00:00:00.000Z") };

function sequentialIds(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

function silentLogger(): Logger {
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => log,
  };
  return log;
}

function wire() {
  const idGenerator = sequentialIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new OrderEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "orders",
  });
  const orders = new InMemoryOrderRepository({ outbox, context: rootEventContext(idGenerator) });
  const unitOfWork = new InMemoryUnitOfWork();
  const placeOrder = new PlaceOrder({ orders, unitOfWork, idGenerator, clock });
  const markOrderPaid = new MarkOrderPaid({ orders, unitOfWork, idGenerator, clock });
  const consumer = new PaymentCapturedConsumer({
    markOrderPaid,
    logger: silentLogger(),
  });
  return { placeOrder, consumer, orders, outbox: outboxStore };
}

function capturedEvent(
  orderId: string,
  messageId = "msg-1",
): IntegrationEvent<PaymentCapturedPayload> {
  return {
    messageId,
    type: "payments.payment_intent.captured",
    eventVersion: 1,
    aggregateId: "intent-1",
    aggregateType: "payment_intent",
    occurredAt: "2026-07-05T00:00:00.000Z",
    correlationId: "corr-1",
    causationId: "cause-1",
    tenantId: "tenant-a",
    payload: { orderRef: orderId, amountMinor: 3998, currency: "USD" },
    metadata: {},
  };
}

async function placeAnOrder(placeOrder: PlaceOrder): Promise<string> {
  const placed = await placeOrder.execute({
    tenantId: "tenant-a",
    customerRef: "customer-1",
    currency: "USD",
    items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
    shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
  });
  if (!placed.ok) throw new Error("setup failed");
  return placed.value.orderId;
}

/** Builds and persists a checkout/saga order sitting at `payment_requested`, ready to be captured. */
async function orderAwaitingCapture(
  orders: InMemoryOrderRepository,
  orderId: string,
): Promise<void> {
  const price = Money.create(1999, "USD");
  if (!price.ok) throw new Error("invalid fixture");
  const snapshot = ProductSnapshot.create("p-1", "Toy Wagon", price.value);
  if (!snapshot.ok) throw new Error("invalid fixture");
  const item = OrderItem.create(UniqueEntityId.from("item-1"), snapshot.value, 2);
  const addressResult = AddressSnapshot.create("1 Main St", "Town", "12345", "US");
  if (!addressResult.ok) throw new Error("invalid fixture");
  const orderNumberResult = OrderNumber.create("ORD-SAGA-1");
  if (!orderNumberResult.ok) throw new Error("invalid fixture");
  const totals = OrderTotalsSnapshot.create({
    subtotalMinor: 3998,
    taxMinor: 0,
    shippingMinor: 0,
    discountMinor: 0,
    totalMinor: 3998,
    currency: "USD",
  });
  const order = Order.createFromCheckout(
    UniqueEntityId.from(orderId),
    orderNumberResult.value,
    "customer-1",
    "USD",
    [item],
    addressResult.value,
    addressResult.value,
    totals,
    "checkout-1",
    "evt-create",
    new Date(0),
  );
  order.confirm("evt-1", new Date(0));
  order.markAwaitingPayment("evt-2", new Date(0));
  order.requestPayment("payment-requested-ref", "evt-3", new Date(0));
  await orders.save(order, "tenant-a");
}

describe("PaymentCapturedConsumer (first real cross-context flow)", () => {
  it("marks the order paid through the application layer", async () => {
    const { placeOrder, consumer, orders } = wire();
    const orderId = await placeAnOrder(placeOrder);

    await consumer.handle(capturedEvent(orderId));

    const order = await orders.findById(orderId, "tenant-a");
    expect(order?.status).toBe("paid");
  });

  it("treats a duplicate capture (order already paid) as idempotent success", async () => {
    const { placeOrder, consumer, orders } = wire();
    const orderId = await placeAnOrder(placeOrder);
    await consumer.handle(capturedEvent(orderId, "msg-1"));

    await expect(consumer.handle(capturedEvent(orderId, "msg-2"))).resolves.toBeUndefined();

    expect((await orders.findById(orderId, "tenant-a"))?.status).toBe("paid");
  });

  it("WP-11 (T11.6): a duplicate captured event produces one paid order and exactly one orders.order.paid event — the guard in markPaid throws before the second call ever raises a second one", async () => {
    const { placeOrder, consumer, orders, outbox } = wire();
    const orderId = await placeAnOrder(placeOrder);

    await consumer.handle(capturedEvent(orderId, "msg-1"));
    await consumer.handle(capturedEvent(orderId, "msg-2")); // redelivery of the same fact

    expect((await orders.findById(orderId, "tenant-a"))?.status).toBe("paid");
    const paidEntries = outbox.snapshot().filter((entry) => entry.topic === "orders.order.paid.v1");
    expect(paidEntries).toHaveLength(1);
  });

  it("throws NotFound for an unknown order (retryable cross-context race)", async () => {
    const { consumer } = wire();
    await expect(consumer.handle(capturedEvent("missing-order"))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws on a capture after refund (genuine anomaly → DLQ, never swallowed)", async () => {
    const { placeOrder, consumer, orders } = wire();
    const orderId = await placeAnOrder(placeOrder);
    await consumer.handle(capturedEvent(orderId, "msg-1"));
    const order = await orders.findById(orderId, "tenant-a");
    order?.refund({ canRefund: (status) => status === "paid" }, "evt-r", clock.now());
    if (order) await orders.save(order, "tenant-a");

    await expect(consumer.handle(capturedEvent(orderId, "msg-3"))).rejects.toThrow(/refunded/);
  });

  it("marks a checkout/saga order (payment_requested) paid through completePayment, reaching payment_received (Sprint A1)", async () => {
    const { consumer, orders } = wire();
    const orderId = "order-saga-1";
    await orderAwaitingCapture(orders, orderId);

    await consumer.handle(capturedEvent(orderId));

    const order = await orders.findById(orderId, "tenant-a");
    expect(order?.status).toBe("payment_received");
  });

  it("treats a duplicate capture for an already-payment_received checkout/saga order as idempotent success (Sprint A1)", async () => {
    const { consumer, orders } = wire();
    const orderId = "order-saga-2";
    await orderAwaitingCapture(orders, orderId);
    await consumer.handle(capturedEvent(orderId, "msg-1"));

    await expect(consumer.handle(capturedEvent(orderId, "msg-2"))).resolves.toBeUndefined();

    expect((await orders.findById(orderId, "tenant-a"))?.status).toBe("payment_received");
  });
});
