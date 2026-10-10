import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { CreateOrderFromCheckout } from "./create-order-from-checkout.use-case";
import { PlaceOrder } from "./place-order.use-case";
import type { OrderNumberAllocator } from "./ports";
import { InMemoryOrderNumberAllocator } from "../infrastructure/in-memory-order-number-allocator";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";

const clock: Clock = { now: () => new Date("2026-10-09T00:00:00.000Z") };

function sequentialIds(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}

function wire(
  orderNumbers: OrderNumberAllocator = new InMemoryOrderNumberAllocator(),
  unitOfWork: TransactionalUnitOfWork<unknown> = new InMemoryUnitOfWork(),
) {
  const idGenerator = sequentialIds();
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new OrderEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "orders",
  });
  const orders = new InMemoryOrderRepository({ outbox, context: rootEventContext(idGenerator) });
  const deps = { orders, unitOfWork, idGenerator, clock, orderNumbers };
  return {
    placeOrder: new PlaceOrder(deps),
    createFromCheckout: new CreateOrderFromCheckout(deps),
  };
}

const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };
const items = [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 1 }];

function placeInput(tenantId: string) {
  return { tenantId, customerRef: "customer-1", currency: "USD", items, shippingAddress: address };
}

function checkoutInput(tenantId: string) {
  return {
    tenantId,
    checkoutRef: "checkout-1",
    customerRef: "customer-1",
    currency: "USD",
    items,
    billingAddress: address,
    shippingAddress: address,
    totals: {
      subtotalMinor: 1999,
      taxMinor: 0,
      shippingMinor: 0,
      discountMinor: 0,
      totalMinor: 1999,
    },
  };
}

describe("order numbers", () => {
  it("PlaceOrder numbers two orders in one shop 1001 then 1002", async () => {
    const { placeOrder } = wire();

    const first = await placeOrder.execute(placeInput("tenant-a"));
    const second = await placeOrder.execute(placeInput("tenant-a"));

    expect(first.ok && first.value.orderNumber).toBe("1001");
    expect(second.ok && second.value.orderNumber).toBe("1002");
  });

  it("CreateOrderFromCheckout numbers two orders in one shop 1001 then 1002", async () => {
    const { createFromCheckout } = wire();

    const first = await createFromCheckout.execute(checkoutInput("tenant-a"));
    const second = await createFromCheckout.execute(checkoutInput("tenant-a"));

    expect(first.ok && first.value.orderNumber).toBe("1001");
    expect(second.ok && second.value.orderNumber).toBe("1002");
  });

  it("both entry points share one sequence per shop", async () => {
    const { placeOrder, createFromCheckout } = wire();

    const placed = await placeOrder.execute(placeInput("tenant-a"));
    const checkedOut = await createFromCheckout.execute(checkoutInput("tenant-a"));

    expect(placed.ok && placed.value.orderNumber).toBe("1001");
    expect(checkedOut.ok && checkedOut.value.orderNumber).toBe("1002");
  });

  it("another shop starts again at 1001", async () => {
    const { placeOrder } = wire();

    await placeOrder.execute(placeInput("tenant-a"));
    await placeOrder.execute(placeInput("tenant-a"));
    const other = await placeOrder.execute(placeInput("tenant-b"));

    expect(other.ok && other.value.orderNumber).toBe("1001");
  });

  it("allocates inside the unit of work, with its transaction and the call's tenant", async () => {
    const transaction = { marker: "tx" };
    const unitOfWork: TransactionalUnitOfWork<unknown> = {
      run: (work) => work(transaction),
    };
    const seen: Array<{ tenantId: string; tx: unknown }> = [];
    const allocator: OrderNumberAllocator = {
      next: async (tenantId, tx) => {
        seen.push({ tenantId, tx });
        return "1001";
      },
    };
    const { placeOrder, createFromCheckout } = wire(allocator, unitOfWork);

    await placeOrder.execute(placeInput("tenant-a"));
    await createFromCheckout.execute(checkoutInput("tenant-b"));

    expect(seen).toEqual([
      { tenantId: "tenant-a", tx: transaction },
      { tenantId: "tenant-b", tx: transaction },
    ]);
  });

  it("does not take a number for an order that fails validation before the transaction", async () => {
    const taken: string[] = [];
    const allocator: OrderNumberAllocator = {
      next: async (tenantId) => {
        taken.push(tenantId);
        return "1001";
      },
    };
    const { placeOrder } = wire(allocator);

    const result = await placeOrder.execute({ ...placeInput("tenant-a"), items: [] });

    expect(result.ok).toBe(false);
    expect(taken).toEqual([]);
  });
});
