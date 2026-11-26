import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateOrderFromCheckout } from "./create-order-from-checkout.use-case";
import { AdvanceOrder } from "./order-lifecycle.use-cases";
import type { NotificationPort } from "./ports";
import { InMemoryOrderNumberAllocator } from "../infrastructure/in-memory-order-number-allocator";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";

/** Wave 2b: the order notification carries the order id, so a trigger can read the order it mails about. */
const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };
const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };

function wire(notifications: NotificationPort) {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new OrderEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "orders",
  });
  const orders = new InMemoryOrderRepository({ outbox, context: rootEventContext(idGenerator) });
  const unitOfWork = new InMemoryUnitOfWork();
  return {
    create: new CreateOrderFromCheckout({
      orders,
      unitOfWork,
      idGenerator,
      clock,
      orderNumbers: new InMemoryOrderNumberAllocator(),
    }),
    advance: new AdvanceOrder({ orders, unitOfWork, idGenerator, clock, notifications }),
  };
}

describe("order lifecycle notification (Wave 2b)", () => {
  it("passes the tenant, the customer, the order number, the new status and the order id", async () => {
    expect.hasAssertions();
    const calls: unknown[][] = [];
    const w = wire({
      notify: (...args) => {
        calls.push(args);
        return Promise.resolve();
      },
    });
    const created = await w.create.execute({
      tenantId: "tenant-a",
      checkoutRef: "checkout-1",
      customerRef: "customer-1",
      currency: "USD",
      items: [{ productId: "p-1", name: "Toy", unitPriceAmountMinor: 1999, quantity: 1 }],
      billingAddress: address,
      shippingAddress: address,
      totals: {
        subtotalMinor: 1999,
        taxMinor: 0,
        shippingMinor: 0,
        discountMinor: 0,
        totalMinor: 1999,
      },
    });
    if (!created.ok) throw new Error("setup failed");
    const { orderId, orderNumber } = created.value;

    await w.advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });
    expect(calls).toEqual([["customer-1", orderNumber, "cancelled", "tenant-a", orderId]]);
  });

  it("a notification that throws never fails the transition", async () => {
    expect.hasAssertions();
    const w = wire({ notify: () => Promise.reject(new Error("mail is down")) });
    const created = await w.create.execute({
      tenantId: "tenant-a",
      checkoutRef: "checkout-2",
      customerRef: "customer-1",
      currency: "USD",
      items: [{ productId: "p-1", name: "Toy", unitPriceAmountMinor: 1999, quantity: 1 }],
      billingAddress: address,
      shippingAddress: address,
      totals: {
        subtotalMinor: 1999,
        taxMinor: 0,
        shippingMinor: 0,
        discountMinor: 0,
        totalMinor: 1999,
      },
    });
    if (!created.ok) throw new Error("setup failed");
    const result = await w.advance.execute({
      tenantId: "tenant-a",
      orderId: created.value.orderId,
      toStatus: "cancelled",
    });
    expect(result.ok && result.value.status).toBe("cancelled");
  });
});
