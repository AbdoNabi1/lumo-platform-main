import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FulfillmentController } from "@platform/fulfillment";
import { CarrierFulfillmentAdapter } from "./carrier-fulfillment.adapter";
import type { ShippableOrder } from "./ports";

beforeEach(() => {
  expect.hasAssertions();
});
const order: ShippableOrder = {
  orderId: "o-1",
  orderNumber: "1001",
  open: true,
  paymentStatus: "paid",
  totalMinor: 100,
  currency: "EGP",
  items: [{ productId: "p-1", name: "Item", variantTitle: null, quantity: 1, imageUrl: null }],
  shippingAddress: { line1: "Street", city: "Cairo", country: "EG" },
};
const success = {
  status: 200,
  body: { id: { toString: () => "f-1" }, status: { value: "created" } },
};
function setup(
  prepare: unknown = {
    status: 200,
    body: { fulfillmentOrderId: "f-1", status: "packing_completed" },
  },
) {
  const api = {
    getByOrder: vi.fn().mockResolvedValue(success),
    create: vi.fn(),
    prepareForCarrier: vi.fn().mockResolvedValue(prepare),
    attachCarrierShipment: vi
      .fn()
      .mockResolvedValue({ status: 409, body: { message: "FULFILLMENT_NOT_ATTACHABLE: no" } }),
    detachCarrierShipment: vi.fn().mockResolvedValue({ status: 200 }),
  };
  return { api, adapter: new CarrierFulfillmentAdapter(api as unknown as FulfillmentController) };
}
describe("CarrierFulfillmentAdapter", () => {
  it.each([
    ["STOCK_NOT_RESERVED", "STOCK_NOT_RESERVED"],
    ["SHIPMENT_IN_PROGRESS", "SHIPMENT_IN_PROGRESS"],
    ["FULFILLMENT_NOT_SHIPPABLE", "ORDER_NOT_SHIPPABLE"],
    ["OTHER", "ORDER_NOT_SHIPPABLE"],
  ])("maps %s from body.message", async (prefix, code) => {
    const { adapter } = setup({
      status: 422,
      body: { code: "BUSINESS_RULE", message: `${prefix}: reason` },
    });
    expect(await adapter.ensureReady("t-1", order)).toEqual({ ok: false, code, httpStatus: 409 });
  });
  it("maps missing fulfillment to ORDER_NOT_FOUND", async () => {
    const { adapter } = setup({ status: 404, body: { message: "missing" } });
    expect(await adapter.ensureReady("t-1", order)).toEqual({
      ok: false,
      code: "ORDER_NOT_FOUND",
      httpStatus: 404,
    });
  });
  it("refuses a dispatched fulfillment", async () => {
    const { adapter, api } = setup();
    api.getByOrder.mockResolvedValue({
      status: 200,
      body: { id: { toString: () => "f-1" }, status: { value: "shipment_dispatched" } },
    });
    expect(await adapter.ensureReady("t-1", order)).toEqual({
      ok: false,
      code: "ORDER_NOT_SHIPPABLE",
      httpStatus: 409,
    });
    expect(api.prepareForCarrier).not.toHaveBeenCalled();
  });
  it("returns false when attach refuses", async () => {
    const { adapter } = setup();
    expect(await adapter.attach("t-1", "f-1", "bosta", "d-1", "5108002")).toBe(false);
  });
  it("creates the fulfillment with all order items", async () => {
    const { adapter, api } = setup();
    api.getByOrder.mockResolvedValue({ status: 404 });
    api.create.mockResolvedValue({
      status: 201,
      body: { fulfillmentOrderId: "f-1", status: "created" },
    });
    expect(await adapter.ensureReady("t-1", order)).toEqual({
      ok: true,
      fulfillmentOrderId: "f-1",
      status: "packing_completed",
    });
    expect(api.create).toHaveBeenCalledWith({
      tenantId: "t-1",
      orderRef: "o-1",
      items: [{ productRef: "p-1", quantity: 1 }],
    });
  });
});
