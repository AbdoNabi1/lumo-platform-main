import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShipOrderWithCarrier } from "./ship-order-with-carrier";
import type { ShippableOrder } from "./ports";
import type { CarrierFulfillmentAdapter } from "./carrier-fulfillment.adapter";
import type { ShippingController } from "@platform/shipping";
import type { DistributedLock } from "@platform/contracts";

beforeEach(() => {
  expect.hasAssertions();
});
const order: ShippableOrder = {
  orderId: "o-1",
  orderNumber: "1001",
  open: true,
  paymentStatus: "pending",
  totalMinor: 25000,
  currency: "EGP",
  paymentRef: "pi-1",
  items: [
    {
      productId: "p-1",
      name: "Shirt",
      variantTitle: "Blue",
      quantity: 2,
      imageUrl: "https://example.com/a",
    },
    {
      productId: "p-2",
      name: "Cap",
      variantTitle: null,
      quantity: 1,
      imageUrl: "http://example.com/b",
    },
  ],
  shippingAddress: {
    recipientName: "Name",
    phone: "123",
    line1: "Street",
    city: "Cairo",
    country: "EG",
  },
};
const input = { tenantId: "t-1", orderId: "o-1", carrierKey: "bosta", idempotencyKey: "key" };
function setup(status = "missing", count = 1) {
  const orders = {
    read: vi.fn().mockResolvedValue(order),
    codIntent: vi.fn().mockResolvedValue({
      provider: "cod",
      status: "created",
      amountMinor: 25000,
      currency: "EGP",
    }),
  };
  const fulfillment = {
    ensureReady: vi
      .fn()
      .mockResolvedValue({ ok: true, fulfillmentOrderId: "f-1", status: "packing_completed" }),
    attach: vi.fn().mockResolvedValue(true),
  };
  const shipment = { id: { toString: () => "s-1" }, status: { value: status } };
  const shipping = {
    getByFulfillment: vi
      .fn()
      .mockResolvedValue(status === "missing" ? { status: 404 } : { status: 200, body: shipment }),
    create: vi
      .fn()
      .mockResolvedValue({ status: 201, body: { shipmentId: "s-1", status: "created" } }),
    countByFulfillment: vi.fn().mockResolvedValue({ status: 200, body: { count } }),
    advance: vi
      .fn()
      .mockResolvedValue({ status: 200, body: { shipmentId: "s-1", status: "created" } }),
    createLabel: vi.fn().mockResolvedValue({
      status: 200,
      body: {
        shipmentId: "s-1",
        status: "label_created",
        carrierKey: "bosta",
        carrierDeliveryId: "d-1",
        trackingNumber: "5108002",
      },
    }),
  };
  const release = vi.fn().mockResolvedValue(true);
  const lock = {
    acquire: vi.fn().mockResolvedValue({ key: "lock", token: "token", release, extend: vi.fn() }),
  };
  const ship = new ShipOrderWithCarrier({
    orders,
    fulfillment: fulfillment as unknown as CarrierFulfillmentAdapter,
    shipping: shipping as unknown as ShippingController,
    lock: lock as DistributedLock,
  });
  return { ship, orders, fulfillment, shipping, lock, release };
}
describe("ShipOrderWithCarrier", () => {
  it("ships with server COD, prepares, creates, labels, and attaches", async () => {
    const s = setup();
    expect(await s.ship.execute(input)).toEqual({
      ok: true,
      value: {
        orderId: "o-1",
        orderNumber: "1001",
        shipmentId: "s-1",
        trackingNumber: "5108002",
        carrierKey: "bosta",
      },
    });
    expect(s.lock.acquire).toHaveBeenCalledWith("carrier-ship:t-1:o-1", 60_000);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.shipping.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        carrier: expect.objectContaining({
          reference: "1001",
          codAmountMinor: 25000,
          itemsCount: 3,
          description: "Shirt (Blue) ×2، Cap ×1",
          packageImages: ["https://example.com/a"],
        }),
      }),
    );
    expect(s.fulfillment.attach).toHaveBeenCalledWith("t-1", "f-1", "bosta", "d-1", "5108002");
  });
  it("a held lock answers SHIPMENT_IN_PROGRESS without reading", async () => {
    const s = setup();
    s.lock.acquire.mockResolvedValue(null);
    expect(await s.ship.execute(input)).toEqual({
      ok: false,
      code: "SHIPMENT_IN_PROGRESS",
      httpStatus: 409,
    });
    expect(s.orders.read).not.toHaveBeenCalled();
  });
  it("keeps a successful shipment result if releasing the best-effort lock fails", async () => {
    const s = setup();
    s.release.mockRejectedValue(new Error("redis down"));
    expect(await s.ship.execute(input)).toMatchObject({
      ok: true,
      value: { trackingNumber: "5108002" },
    });
  });
  it("releases the lock when createLabel throws", async () => {
    const s = setup();
    s.shipping.createLabel.mockRejectedValue(new Error("failure"));
    await expect(s.ship.execute(input)).rejects.toThrow("failure");
    expect(s.release).toHaveBeenCalledTimes(1);
  });
  it("reattaches an already labelled order", async () => {
    const s = setup("label_created");
    const result = await s.ship.execute(input);
    expect(result).toMatchObject({ ok: true, value: { trackingNumber: "5108002" } });
    expect(s.fulfillment.attach).toHaveBeenCalledWith("t-1", "f-1", "bosta", "d-1", "5108002");
  });
  it("returns a voided shipment to created", async () => {
    const s = setup("voided");
    await s.ship.execute(input);
    expect(s.shipping.advance).toHaveBeenCalledWith({
      tenantId: "t-1",
      shipmentId: "s-1",
      toStatus: "created",
    });
  });
  it("blocks exception shipments", async () => {
    const s = setup("exception");
    expect(await s.ship.execute(input)).toEqual({
      ok: false,
      code: "SHIPMENT_NEEDS_REVIEW",
      httpStatus: 409,
      orderNumber: "1001",
    });
    expect(s.shipping.createLabel).not.toHaveBeenCalled();
  });
  it("preserves the replacement base after a definite failure", async () => {
    const s = setup("created", 2);
    s.shipping.createLabel.mockResolvedValueOnce({
      status: 422,
      body: { code: "ADDRESS_NOT_SHIPPABLE", reason: "CITY_NOT_FOUND" },
    });
    expect(await s.ship.execute(input)).toEqual({
      ok: false,
      code: "ADDRESS_NOT_SHIPPABLE",
      httpStatus: 422,
      reason: "CITY_NOT_FOUND",
      orderNumber: "1001",
    });
    expect((await s.ship.execute(input)).ok).toBe(true);
    expect(s.shipping.createLabel).toHaveBeenCalledTimes(2);
    for (const call of s.shipping.createLabel.mock.calls)
      expect(call[0].carrier.reference).toBe("1001-r1");
  });
  it("uses the replacement base after manual retry", async () => {
    const s = setup("exception", 2);
    expect(await s.ship.execute(input)).toMatchObject({ ok: false, code: "SHIPMENT_NEEDS_REVIEW" });
    s.shipping.getByFulfillment.mockResolvedValue({
      status: 200,
      body: { id: { toString: () => "s-1" }, status: { value: "created" } },
    });
    expect((await s.ship.execute(input)).ok).toBe(true);
    expect(s.shipping.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ carrier: expect.objectContaining({ reference: "1001-r1" }) }),
    );
  });
  it("creates a new shipment for a carrier-cancelled predecessor", async () => {
    const s = setup("cancelled", 2);
    expect((await s.ship.execute(input)).ok).toBe(true);
    expect(s.shipping.create).toHaveBeenCalledWith({
      tenantId: "t-1",
      fulfillmentRef: "f-1",
      packages: [{ reference: "1001", itemRefs: ["p-1", "p-2"], weightGrams: 1 }],
    });
    expect(s.shipping.countByFulfillment.mock.invocationCallOrder[0]).toBeGreaterThan(
      s.shipping.create.mock.invocationCallOrder[0]!,
    );
    expect(s.shipping.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ carrier: expect.objectContaining({ reference: "1001-r1" }) }),
    );
  });
  it.each([
    ["cancelled", 2],
    ["created", 2],
    ["voided", 2],
  ])("uses stable replacement reference for %s", async (status, count) => {
    const s = setup(status as string, count as number);
    await s.ship.execute(input);
    expect(s.shipping.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ carrier: expect.objectContaining({ reference: "1001-r1" }) }),
    );
  });
});
