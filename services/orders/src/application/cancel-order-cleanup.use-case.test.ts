import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateOrderFromCheckout } from "./create-order-from-checkout.use-case";
import { AdvanceOrder } from "./order-lifecycle.use-cases";
import type { FulfillmentCancelPort, PaymentVoidPort, StockReleasePort } from "./ports";
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

interface Call {
  readonly effect: "fulfillment" | "stock" | "payment";
  readonly ref: string;
  readonly tenantId: string;
  /** The order's status when the effect ran — it must already be saved as cancelled. */
  readonly orderStatusSeen: string | undefined;
}

type Throwing = "fulfillment" | "stock" | "payment";

function wire(options: { throwing?: readonly Throwing[]; withPorts?: boolean } = {}) {
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
  const calls: Call[] = [];
  let watched = "";
  const record = async (effect: Call["effect"], ref: string, tenantId: string) => {
    const order = await orders.findById(watched, tenantId);
    calls.push({ effect, ref, tenantId, orderStatusSeen: order?.status });
    if (options.throwing?.includes(effect)) throw new Error(`${effect} is down`);
  };
  const fulfillmentCancel: FulfillmentCancelPort = {
    cancelOpenFulfillment: (orderId, tenantId) => record("fulfillment", orderId, tenantId),
  };
  const stockRelease: StockReleasePort = {
    releaseOrderStock: (orderId, tenantId) => record("stock", orderId, tenantId),
  };
  const paymentVoid: PaymentVoidPort = {
    voidPayment: (paymentRef, tenantId) => record("payment", paymentRef, tenantId),
  };
  const create = new CreateOrderFromCheckout({
    orders,
    unitOfWork,
    idGenerator,
    clock,
    orderNumbers: new InMemoryOrderNumberAllocator(),
  });
  const advance = new AdvanceOrder({
    orders,
    unitOfWork,
    idGenerator,
    clock,
    ...(options.withPorts === false ? {} : { fulfillmentCancel, stockRelease, paymentVoid }),
  });
  const link = new RecordCheckoutPayment({ orders, unitOfWork, idGenerator, clock });
  return {
    create,
    advance,
    link,
    orders,
    calls,
    watch: (orderId: string) => {
      watched = orderId;
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

/** A cash-on-delivery order waiting for its cash: payment_requested, with a linked payment. */
async function pendingOrder(w: ReturnType<typeof wire>): Promise<string> {
  const orderId = await checkoutOrder(w.create);
  w.watch(orderId);
  await w.link.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });
  return orderId;
}

describe("cancelling an order cleans up after it (G-130, G-126)", () => {
  it("cancels the order's open fulfillment, releases its reserved stock and voids its payment, all after the cancel is saved", async () => {
    const w = wire();
    const orderId = await pendingOrder(w);

    const result = await w.advance.execute({
      tenantId: "tenant-a",
      orderId,
      toStatus: "cancelled",
    });

    expect(result.ok && result.value.status).toBe("cancelled");
    expect(w.calls).toEqual([
      { effect: "fulfillment", ref: orderId, tenantId: "tenant-a", orderStatusSeen: "cancelled" },
      { effect: "stock", ref: orderId, tenantId: "tenant-a", orderStatusSeen: "cancelled" },
      { effect: "payment", ref: "intent-1", tenantId: "tenant-a", orderStatusSeen: "cancelled" },
    ]);
  });

  it("cleans up fulfillment and stock even when the order has no linked payment", async () => {
    const w = wire();
    const orderId = await checkoutOrder(w.create);
    w.watch(orderId);

    await w.advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    expect(w.calls.map((c) => c.effect)).toEqual(["fulfillment", "stock"]);
  });

  it.each<Throwing>(["fulfillment", "stock", "payment"])(
    "a failure in the %s cleanup never fails the cancellation nor stops the other two",
    async (failing) => {
      const w = wire({ throwing: [failing] });
      const orderId = await pendingOrder(w);

      const result = await w.advance.execute({
        tenantId: "tenant-a",
        orderId,
        toStatus: "cancelled",
      });

      expect(result.ok && result.value.status).toBe("cancelled");
      expect((await w.orders.findById(orderId, "tenant-a"))?.status).toBe("cancelled");
      expect(w.calls.map((c) => c.effect).sort()).toEqual(["fulfillment", "payment", "stock"]);
    },
  );

  it("does nothing for a transition that is not a cancellation", async () => {
    const w = wire();
    const orderId = await pendingOrder(w);

    await w.advance.execute({ tenantId: "tenant-a", orderId, toStatus: "payment_failed" });

    expect(w.calls).toEqual([]);
  });

  it("does nothing when the cancellation is refused", async () => {
    const w = wire();
    const orderId = await pendingOrder(w);
    await w.advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });
    w.calls.length = 0;

    const again = await w.advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    expect(again.ok).toBe(false);
    expect(w.calls).toEqual([]);
  });

  it("is optional: an AdvanceOrder wired without the ports still cancels", async () => {
    const w = wire({ withPorts: false });
    const orderId = await pendingOrder(w);

    const result = await w.advance.execute({
      tenantId: "tenant-a",
      orderId,
      toStatus: "cancelled",
    });

    expect(result.ok && result.value.status).toBe("cancelled");
  });
});
