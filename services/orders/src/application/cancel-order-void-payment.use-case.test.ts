import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateOrderFromCheckout } from "./create-order-from-checkout.use-case";
import { AdvanceOrder } from "./order-lifecycle.use-cases";
import type { PaymentVoidPort } from "./ports";
import { RecordCheckoutPayment } from "./record-checkout-payment.use-case";
import { InMemoryOrderNumberAllocator } from "../infrastructure/in-memory-order-number-allocator";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";

const clock: Clock = { now: () => new Date("2026-10-10T00:00:00.000Z") };

function sequentialIds(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

interface VoidCall {
  readonly paymentRef: string;
  readonly tenantId: string;
  /** The order's status when the port was called — to prove the void runs after the cancel is saved. */
  readonly orderStatusSeen: string | undefined;
}

function wire(voidBehavior: "ok" | "throws" = "ok") {
  const idGenerator = sequentialIds();
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new OrderEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "orders",
  });
  const orders = new InMemoryOrderRepository({ outbox, context: rootEventContext(idGenerator) });
  const unitOfWork = new InMemoryUnitOfWork();
  const calls: VoidCall[] = [];
  let orderIdForPort = "";
  const paymentVoid: PaymentVoidPort = {
    async voidPayment(paymentRef, tenantId) {
      const order = await orders.findById(orderIdForPort, tenantId);
      calls.push({ paymentRef, tenantId, orderStatusSeen: order?.status });
      if (voidBehavior === "throws") throw new Error("payments is down");
    },
  };
  const create = new CreateOrderFromCheckout({
    orders,
    unitOfWork,
    idGenerator,
    clock,
    orderNumbers: new InMemoryOrderNumberAllocator(),
  });
  const advance = new AdvanceOrder({ orders, unitOfWork, idGenerator, clock, paymentVoid });
  const record = new RecordCheckoutPayment({ orders, unitOfWork, idGenerator, clock });
  return {
    create,
    advance,
    record,
    orders,
    calls,
    watch: (orderId: string) => {
      orderIdForPort = orderId;
    },
  };
}

const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };

async function checkoutOrder(create: CreateOrderFromCheckout): Promise<string> {
  const created = await create.execute({
    tenantId: "tenant-a",
    checkoutRef: "checkout-1",
    customerRef: "customer-1",
    currency: "USD",
    items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
    billingAddress: address,
    shippingAddress: address,
    totals: {
      subtotalMinor: 3998,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 3998,
    },
  });
  if (!created.ok) throw new Error("setup failed");
  return created.value.orderId;
}

describe("cancelling an order voids its unpaid payment (G-126)", () => {
  it("cancels a pending cash-on-delivery order and voids its payment intent once", async () => {
    const { create, record, advance, orders, calls, watch } = wire();
    const orderId = await checkoutOrder(create);
    watch(orderId);
    await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    const result = await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    expect(result.ok && result.value.status).toBe("cancelled");
    expect((await orders.findById(orderId, "tenant-a"))?.status).toBe("cancelled");
    expect(calls).toEqual([
      { paymentRef: "intent-1", tenantId: "tenant-a", orderStatusSeen: "cancelled" },
    ]);
  });

  it("does not touch Payments for an order that has no linked payment", async () => {
    const { create, advance, calls, watch } = wire();
    const orderId = await checkoutOrder(create);
    watch(orderId);

    const result = await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    expect(result.ok && result.value.status).toBe("cancelled");
    expect(calls).toEqual([]);
  });

  it("does not void the payment for a transition that is not a cancellation", async () => {
    const { create, record, advance, calls, watch } = wire();
    const orderId = await checkoutOrder(create);
    watch(orderId);
    await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    const result = await advance.execute({
      tenantId: "tenant-a",
      orderId,
      toStatus: "payment_failed",
    });

    expect(result.ok && result.value.status).toBe("payment_failed");
    expect(calls).toEqual([]);
  });

  it("does not void anything when the cancellation itself is refused", async () => {
    const { create, advance, orders, calls, watch } = wire();
    const orderId = await checkoutOrder(create);
    watch(orderId);
    await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "confirmed" });
    await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });
    calls.length = 0;

    // A cancelled order cannot be cancelled again.
    const again = await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    expect(again.ok).toBe(false);
    expect(calls).toEqual([]);
    expect((await orders.findById(orderId, "tenant-a"))?.status).toBe("cancelled");
  });

  it("still cancels the order when voiding the payment fails — the shopper's order is not held hostage", async () => {
    const { create, record, advance, orders, calls, watch } = wire("throws");
    const orderId = await checkoutOrder(create);
    watch(orderId);
    await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    const result = await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    expect(result.ok && result.value.status).toBe("cancelled");
    expect((await orders.findById(orderId, "tenant-a"))?.status).toBe("cancelled");
    expect(calls).toHaveLength(1);
  });

  it("is optional: an AdvanceOrder wired without the port still cancels", async () => {
    const idGenerator = sequentialIds();
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "orders",
    });
    const orders = new InMemoryOrderRepository({ outbox, context: rootEventContext(idGenerator) });
    const unitOfWork = new InMemoryUnitOfWork();
    const create = new CreateOrderFromCheckout({
      orders,
      unitOfWork,
      idGenerator,
      clock,
      orderNumbers: new InMemoryOrderNumberAllocator(),
    });
    const record = new RecordCheckoutPayment({ orders, unitOfWork, idGenerator, clock });
    const advance = new AdvanceOrder({ orders, unitOfWork, idGenerator, clock });
    const orderId = await checkoutOrder(create);
    await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    const result = await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    expect(result.ok && result.value.status).toBe("cancelled");
  });
});
