import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireOrders } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wireOrders({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

const sampleOrder = {
  tenantId: "tenant-a",
  customerRef: "customer-1",
  currency: "USD",
  items: [
    { productId: "product-1", name: "Toy Wagon", unitPriceAmountMinor: 1500, quantity: 2 },
    { productId: "product-2", name: "Blocks", unitPriceAmountMinor: 500, quantity: 1 },
  ],
  shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
};

describe("orders (end to end)", () => {
  it("places, pays, and refunds an order, publishing the lifecycle events", async () => {
    const app = wire();

    const placed = await app.orders.place(sampleOrder);
    expect(placed.status).toBe(201);
    const body = placed.body as { orderId: string; orderNumber: string; totalAmountMinor: number };
    expect(body.totalAmountMinor).toBe(3500);
    expect(body.orderNumber).toBe("1001");

    const paid = await app.orders.markPaid({
      tenantId: "tenant-a",
      orderId: body.orderId,
      paymentRef: "payment-1",
    });
    expect(paid.status).toBe(200);
    expect((paid.body as { status: string }).status).toBe("paid");

    const refunded = await app.orders.refund({ tenantId: "tenant-a", orderId: body.orderId });
    expect(refunded.status).toBe(200);
    expect((refunded.body as { status: string }).status).toBe("refunded");

    expect(await app.drainOutbox()).toBe(3);
    expect(app.deliveredEventTypes).toEqual([
      "orders.order.placed",
      "orders.order.paid",
      "orders.order.refunded",
    ]);
  });

  it("rejects placing an order with no items (422)", async () => {
    const app = wire();
    const response = await app.orders.place({ ...sampleOrder, items: [] });
    expect(response.status).toBe(422);
  });

  it("returns 404 when paying an unknown order", async () => {
    const app = wire();
    const response = await app.orders.markPaid({
      tenantId: "tenant-a",
      orderId: "missing",
      paymentRef: "payment-1",
    });
    expect(response.status).toBe(404);
  });

  it("rejects refunding an unpaid order (409)", async () => {
    const app = wire();
    const placed = await app.orders.place(sampleOrder);
    const orderId = (placed.body as { orderId: string }).orderId;
    const response = await app.orders.refund({ tenantId: "tenant-a", orderId });
    expect(response.status).toBe(409);
  });

  it("runs the full Sprint 4.7 lifecycle: create-from-checkout -> confirm -> payment -> fulfillment -> delivered -> closed", async () => {
    const app = wire();

    const created = await app.orders.createFromCheckout({
      tenantId: "tenant-a",
      checkoutRef: "checkout-1",
      customerRef: "customer-1",
      currency: "USD",
      items: [
        { productId: "product-1", name: "Toy Wagon", unitPriceAmountMinor: 1500, quantity: 2 },
      ],
      billingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      totals: {
        subtotalMinor: 3000,
        taxMinor: 100,
        shippingMinor: 500,
        discountMinor: 0,
        totalMinor: 3600,
      },
    });
    expect(created.status).toBe(201);
    const orderId = (created.body as { orderId: string }).orderId;
    expect((created.body as { status: string }).status).toBe("created");

    expect(
      (await app.orders.advance({ tenantId: "tenant-a", orderId, toStatus: "confirmed" })).status,
    ).toBe(200);
    expect(
      (await app.orders.advance({ tenantId: "tenant-a", orderId, toStatus: "awaiting_payment" }))
        .status,
    ).toBe(200);

    const paymentRequested = await app.orders.requestPaymentCapture({
      tenantId: "tenant-a",
      orderId,
    });
    expect(paymentRequested.status).toBe(200);
    expect((paymentRequested.body as { status: string }).status).toBe("payment_requested");

    expect(
      (await app.orders.advance({ tenantId: "tenant-a", orderId, toStatus: "payment_received" }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.orders.advance({
          tenantId: "tenant-a",
          orderId,
          toStatus: "ready_for_fulfillment",
        })
      ).status,
    ).toBe(200);

    const fulfillmentRequested = await app.orders.requestFulfillment({
      tenantId: "tenant-a",
      orderId,
    });
    expect(fulfillmentRequested.status).toBe(200);
    expect((fulfillmentRequested.body as { status: string }).status).toBe("fulfillment_requested");

    expect(
      (await app.orders.advance({ tenantId: "tenant-a", orderId, toStatus: "fulfilled" })).status,
    ).toBe(200);
    expect(
      (await app.orders.advance({ tenantId: "tenant-a", orderId, toStatus: "delivered" })).status,
    ).toBe(200);
    const closed = await app.orders.advance({ tenantId: "tenant-a", orderId, toStatus: "closed" });
    expect(closed.status).toBe(200);
    expect((closed.body as { status: string }).status).toBe("closed");
  });

  it("rejects an illegal transition (409)", async () => {
    const app = wire();
    const created = await app.orders.createFromCheckout({
      tenantId: "tenant-a",
      checkoutRef: "checkout-2",
      customerRef: "customer-1",
      currency: "USD",
      items: [
        { productId: "product-1", name: "Toy Wagon", unitPriceAmountMinor: 1500, quantity: 1 },
      ],
      billingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      totals: {
        subtotalMinor: 1500,
        taxMinor: 0,
        shippingMinor: 0,
        discountMinor: 0,
        totalMinor: 1500,
      },
    });
    const orderId = (created.body as { orderId: string }).orderId;

    const response = await app.orders.advance({
      tenantId: "tenant-a",
      orderId,
      toStatus: "fulfilled",
    });
    expect(response.status).toBe(409);
  });

  it("returns a single order by id", async () => {
    const app = wire();
    const placed = await app.orders.place(sampleOrder);
    const orderId = (placed.body as { orderId: string }).orderId;

    const response = await app.orders.getOrder({ tenantId: "tenant-a", orderId });
    expect(response.status).toBe(200);
  });

  it("Plan 2A: a variant line keeps its sku and variantTitle; a legacy line has none", async () => {
    const app = wire();
    const placed = await app.orders.place({
      ...sampleOrder,
      items: [
        {
          productId: "product-1",
          name: "Shirt",
          unitPriceAmountMinor: 12000,
          quantity: 1,
          variantRef: "variant-l",
          sku: "SHIRT-L",
          variantTitle: "L",
        },
        { productId: "product-2", name: "Blocks", unitPriceAmountMinor: 500, quantity: 1 },
      ],
    });
    expect(placed.status).toBe(201);
    const orderId = (placed.body as { orderId: string }).orderId;

    const response = await app.orders.getOrder({ tenantId: "tenant-a", orderId });
    const order = response.body as {
      items: readonly {
        snapshot: {
          name: string;
          variantRef: string | undefined;
          sku: string | undefined;
          variantTitle: string | null | undefined;
        };
      }[];
    };
    expect(
      order.items.map((i) => [
        i.snapshot.name,
        i.snapshot.variantRef,
        i.snapshot.sku,
        i.snapshot.variantTitle,
      ]),
    ).toEqual([
      ["Shirt", "variant-l", "SHIRT-L", "L"],
      ["Blocks", undefined, undefined, undefined],
    ]);
  });

  // Plan 3B: the shopper's selected shipping method is snapshotted into the order's totals JSON.
  it("snapshots the selected shipping method into the order's totals", async () => {
    const app = wire();
    const address = { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" };
    const create = (shippingMethod?: string) =>
      app.orders.createFromCheckout({
        tenantId: "tenant-a",
        checkoutRef: "checkout-1",
        customerRef: "customer-1",
        currency: "USD",
        items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1500, quantity: 1 }],
        billingAddress: address,
        shippingAddress: address,
        totals: {
          subtotalMinor: 1500,
          taxMinor: 0,
          shippingMinor: 500,
          discountMinor: 0,
          totalMinor: 2000,
          ...(shippingMethod === undefined ? {} : { shippingMethod }),
        },
      });
    const withMethod = await create("standard");
    const without = await create();

    const read = async (response: { body: unknown }) =>
      (
        await app.orders.getOrder({
          tenantId: "tenant-a",
          orderId: (response.body as { orderId: string }).orderId,
        })
      ).body as { totals?: { shippingMethod?: string } };
    expect((await read(withMethod)).totals?.shippingMethod).toBe("standard");
    expect((await read(without)).totals?.shippingMethod).toBeUndefined();
  });
});
