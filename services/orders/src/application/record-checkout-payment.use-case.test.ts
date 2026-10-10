import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateOrderFromCheckout } from "./create-order-from-checkout.use-case";
import { AdvanceOrder } from "./order-lifecycle.use-cases";
import { RecordCheckoutPayment } from "./record-checkout-payment.use-case";
import type { Order } from "../domain/order";
import type { OrderListQuery, OrderRepository } from "../domain/order-repository";
import { InMemoryOrderNumberAllocator } from "../infrastructure/in-memory-order-number-allocator";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";

const clock: Clock = { now: () => new Date("2026-10-09T00:00:00.000Z") };

function sequentialIds(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

/** The in-memory repository, counting how many times an order is saved. */
class CountingRepository implements OrderRepository {
  saves = 0;
  private readonly inner: InMemoryOrderRepository;

  constructor(inner: InMemoryOrderRepository) {
    this.inner = inner;
  }

  async save(order: Order, tenantId: string, tx?: unknown): Promise<void> {
    this.saves += 1;
    await this.inner.save(order, tenantId, tx);
  }

  findById(id: string, tenantId: string) {
    return this.inner.findById(id, tenantId);
  }

  list(query: OrderListQuery, tenantId: string) {
    return this.inner.list(query, tenantId);
  }
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
  const orders = new CountingRepository(
    new InMemoryOrderRepository({ outbox, context: rootEventContext(idGenerator) }),
  );
  const unitOfWork = new InMemoryUnitOfWork();
  const orderNumbers = new InMemoryOrderNumberAllocator();
  const create = new CreateOrderFromCheckout({
    orders,
    unitOfWork,
    idGenerator,
    clock,
    orderNumbers,
  });
  const advance = new AdvanceOrder({ orders, unitOfWork, idGenerator, clock });
  const record = new RecordCheckoutPayment({ orders, unitOfWork, idGenerator, clock });
  return { create, advance, record, orders, outboxStore };
}

const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };

async function checkoutOrder(create: CreateOrderFromCheckout, tenantId = "tenant-a") {
  const created = await create.execute({
    tenantId,
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

describe("RecordCheckoutPayment", () => {
  it("walks a created order to payment_requested and records the payment ref, in ONE save", async () => {
    const { create, record, orders } = wire();
    const orderId = await checkoutOrder(create);
    const savesBefore = orders.saves;

    const result = await record.execute({
      tenantId: "tenant-a",
      orderId,
      paymentRef: "intent-1",
    });

    expect(result.ok && result.value.status).toBe("payment_requested");
    expect(orders.saves - savesBefore).toBe(1);
    const order = await orders.findById(orderId, "tenant-a");
    expect(order?.status).toBe("payment_requested");
    expect(order?.paymentRef).toBe("intent-1");
    expect(order?.history.map((entry) => entry.type)).toEqual([
      "created",
      "confirmed",
      "awaiting_payment",
      "payment_requested",
    ]);
  });

  it("publishes the three transitions through the existing outbox path", async () => {
    const { create, record, outboxStore } = wire();
    const orderId = await checkoutOrder(create);
    const before = outboxStore.snapshot().length;

    await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    expect(outboxStore.snapshot().length - before).toBe(3);
  });

  it("is idempotent: the same payment ref again is ok and records nothing new", async () => {
    const { create, record, orders } = wire();
    const orderId = await checkoutOrder(create);
    await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });
    const savesBefore = orders.saves;

    const again = await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    expect(again.ok && again.value.status).toBe("payment_requested");
    expect(orders.saves).toBe(savesBefore);
    expect((await orders.findById(orderId, "tenant-a"))?.history).toHaveLength(4);
  });

  it("refuses a different payment ref once one is recorded", async () => {
    const { create, record } = wire();
    const orderId = await checkoutOrder(create);
    await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    const other = await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-2" });

    expect(!other.ok && other.error.code).toBe("BUSINESS_RULE");
  });

  it("refuses a cancelled order", async () => {
    const { create, advance, record, orders } = wire();
    const orderId = await checkoutOrder(create);
    await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "cancelled" });

    const result = await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    expect(!result.ok && result.error.code).toBe("BUSINESS_RULE");
    const order = await orders.findById(orderId, "tenant-a");
    expect(order?.status).toBe("cancelled");
    expect(order?.paymentRef).toBeUndefined();
  });

  it("refuses an order that was already moved along by hand without a payment", async () => {
    const { create, advance, record } = wire();
    const orderId = await checkoutOrder(create);
    await advance.execute({ tenantId: "tenant-a", orderId, toStatus: "confirmed" });

    const result = await record.execute({ tenantId: "tenant-a", orderId, paymentRef: "intent-1" });

    expect(!result.ok && result.error.code).toBe("BUSINESS_RULE");
  });

  it("reports an unknown order as not found", async () => {
    const { record } = wire();

    const result = await record.execute({
      tenantId: "tenant-a",
      orderId: "missing",
      paymentRef: "intent-1",
    });

    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });

  it("cannot reach another shop's order", async () => {
    const { create, record, orders } = wire();
    const orderId = await checkoutOrder(create, "tenant-a");

    const result = await record.execute({ tenantId: "tenant-b", orderId, paymentRef: "intent-1" });

    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect((await orders.findById(orderId, "tenant-a"))?.status).toBe("created");
  });
});
