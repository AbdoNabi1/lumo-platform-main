import { beforeEach, expect, it, vi } from "vitest";
import type { Principal } from "@platform/contracts";
import { CarrierShippingAdminController } from "./carrier-shipping.admin-controller";
import type { AdminGuard } from "./admin-guard";
import type { ShippingController } from "@platform/shipping";
import type { FulfillmentController } from "@platform/fulfillment";
import type { CarrierOrderReader } from "../carrier-shipping/ports";
import type { CarrierFulfillmentAdapter } from "../carrier-shipping/carrier-fulfillment.adapter";
import type { ShipOrderWithCarrier } from "../carrier-shipping/ship-order-with-carrier";

beforeEach(() => {
  expect.hasAssertions();
});
const principal = {} as Principal;
function setup(status = "created") {
  const orders = { read: vi.fn().mockResolvedValue({ orderNumber: "1001" }) };
  const rawFulfillment = {
    getByOrder: vi.fn().mockResolvedValue({ status: 200, body: { id: { toString: () => "f-1" } } }),
  };
  const shipping = {
    getByFulfillment: vi.fn().mockResolvedValue({
      status: 200,
      body: {
        id: { toString: () => "s-1" },
        status: { value: status },
        label: status === "label_created" ? {} : undefined,
        carrier: status === "label_created" ? {} : undefined,
        trackingNumber: status === "label_created" ? {} : undefined,
      },
    }),
    printCarrierAwbs: vi
      .fn()
      .mockResolvedValue({ status: 200, body: { pdf: new Uint8Array([37, 80, 68, 70]) } }),
    cancelCarrierShipment: vi.fn().mockResolvedValue({
      status: 200,
      body: {
        shipmentId: "s-1",
        status: "voided",
        fulfillmentRef: "f-1",
        trackingNumber: "old-tn",
      },
    }),
    listEnabledCarriers: vi.fn().mockResolvedValue({ status: 200, body: { carriers: [] } }),
  };
  const fulfillment = { detach: vi.fn().mockResolvedValue(true) };
  const controller = new CarrierShippingAdminController({
    guard: { ensure: vi.fn().mockResolvedValue(null) } as unknown as AdminGuard,
    orders: orders as unknown as CarrierOrderReader,
    rawFulfillment: rawFulfillment as unknown as FulfillmentController,
    fulfillment: fulfillment as unknown as CarrierFulfillmentAdapter,
    shipping: shipping as unknown as ShippingController,
    shipper: {} as ShipOrderWithCarrier,
  });
  return { controller, shipping, fulfillment };
}
it("returns all unlabelled order numbers without calling shipping print", async () => {
  const s = setup();
  expect(
    await s.controller.printAwbs(principal, { tenantId: "t-1", orderIds: ["o-1"] }),
  ).toMatchObject({ status: 409, body: { code: "AWB_NOT_AVAILABLE", orderNumbers: ["1001"] } });
  expect(s.shipping.printCarrierAwbs).not.toHaveBeenCalled();
});
it("returns a private no-store PDF", async () => {
  const s = setup("label_created");
  const response = await s.controller.printAwbs(principal, { tenantId: "t-1", orderIds: ["o-1"] });
  expect(response).toMatchObject({
    status: 200,
    headers: { "content-type": "application/pdf", "cache-control": "private, no-store" },
  });
  expect(Buffer.isBuffer(response.body)).toBe(true);
});
it("detaches the fulfillment after cancellation", async () => {
  const s = setup();
  expect(
    await s.controller.cancel(principal, { tenantId: "t-1", shipmentId: "s-1" }),
  ).toMatchObject({ status: 200, body: { shipmentId: "s-1", status: "voided" } });
  expect(s.fulfillment.detach).toHaveBeenCalledWith("t-1", "f-1", "old-tn");
});
