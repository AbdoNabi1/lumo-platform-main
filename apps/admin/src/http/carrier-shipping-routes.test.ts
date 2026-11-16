import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryCarrierCredentialVault } from "@platform/shipping";
import { fakeRegistration } from "@platform/shipping/testing";
import { createAdminHttpApi } from "./server";
import { CarrierShippingAdminController } from "../interfaces/carrier-shipping.admin-controller";
import { CarrierFulfillmentAdapter } from "../carrier-shipping/carrier-fulfillment.adapter";

beforeEach(() => {
  expect.hasAssertions();
});
let app: FastifyInstance;
const headers = {
  authorization: "Bearer admin",
  "x-tenant-id": "t-1",
  "content-type": "application/json",
  "idempotency-key": "test-key",
};
const fake = fakeRegistration();
beforeAll(async () => {
  app = await createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => crypto.randomUUID() },
    clock: { now: () => new Date() },
    authenticator: {
      verify: () => Promise.resolve({ id: "admin", kind: "staff", roles: ["admin"] }),
    },
    rateLimiter: {
      consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    },
    idempotencyKeys: {
      claim: (key) => Promise.resolve({ key, token: "t", release: () => Promise.resolve(true) }),
    },
    responseCache: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      has: () => Promise.resolve(false),
    },
    carrierRegistrations: [fake.registration],
    carrierCredentialVault: new InMemoryCarrierCredentialVault(),
  });
});
afterAll(async () => {
  await app.close();
});
it.each([
  { carrierKey: "bosta", cod: 1 },
  { carrierKey: "bosta", amount: 1 },
])("rejects client amounts as 422 VALIDATION", async (payload) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/orders/o-1/carrier-shipments",
    headers,
    payload,
  });
  expect(response.statusCode).toBe(422);
  expect(response.json()).toMatchObject({ code: "VALIDATION" });
});
it.each([Array.from({ length: 51 }, (_, i) => `o-${i}`), ["o-1", "o-1"]])(
  "rejects oversized or duplicate bulk ids",
  async (orderIds) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/orders/carrier-shipments",
      headers,
      payload: { carrierKey: "bosta", orderIds },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "VALIDATION" });
  },
);
it("ships, prints, isolates and cancels a real order end-to-end", async () => {
  const configured = await app.inject({
    method: "PUT",
    url: "/api/v1/shipping/carriers/bosta",
    headers,
    payload: { enabled: true, credentials: { apiKey: "key" } },
  });
  expect(configured.statusCode).toBe(200);
  const placed = await app.inject({
    method: "POST",
    url: "/api/v1/orders",
    headers,
    payload: {
      customerRef: "c-1",
      currency: "EGP",
      items: [{ productId: "p-1", name: "Shirt", unitPriceAmountMinor: 25000, quantity: 1 }],
      shippingAddress: {
        recipientName: "Name",
        phone: "01000000000",
        line1: "1 Main Street",
        city: "Cairo",
        postalCode: "11511",
        country: "EG",
        province: "Cairo",
      },
    },
  });
  expect(placed.statusCode).toBe(201);
  const orderId = placed.json().orderId as string;
  const unavailable = await app.inject({
    method: "POST",
    url: "/api/v1/shipments/awb",
    headers,
    payload: { orderIds: [orderId] },
  });
  expect(unavailable.statusCode).toBe(409);
  expect(unavailable.json()).toMatchObject({
    code: "AWB_NOT_AVAILABLE",
    orderNumbers: [placed.json().orderNumber],
  });
  const paid = await app.inject({
    method: "POST",
    url: `/api/v1/orders/${orderId}/mark-paid`,
    headers,
    payload: { paymentRef: "pay-1" },
  });
  expect(paid.statusCode).toBe(200);
  const unknown = await app.inject({
    method: "POST",
    url: `/api/v1/orders/${orderId}/carrier-shipments`,
    headers,
    payload: { carrierKey: "aramex" },
  });
  expect(unknown.statusCode, unknown.body).toBe(422);
  expect(unknown.json()).toMatchObject({ code: "CARRIER_UNKNOWN" });
  const shipped = await app.inject({
    method: "POST",
    url: `/api/v1/orders/${orderId}/carrier-shipments`,
    headers,
    payload: { carrierKey: "bosta" },
  });
  expect(shipped.statusCode, shipped.body).toBe(200);
  const firstReference = `${placed.json().orderNumber}-1`;
  expect(fake.record.createCalls[0]?.request.reference).toBe(firstReference);
  expect(fake.record.createCalls[0]?.request.codAmountMinor).toBe(0);
  const shipmentId = shipped.json().shipmentId as string;
  const again = await app.inject({
    method: "POST",
    url: `/api/v1/orders/${orderId}/carrier-shipments`,
    headers,
    payload: { carrierKey: "bosta" },
  });
  expect(again.statusCode).toBe(200);
  expect(again.json().trackingNumber).toBe(shipped.json().trackingNumber);
  expect(fake.record.createCalls).toHaveLength(1);
  const other = { ...headers, "x-tenant-id": "t-2" };
  expect(
    (
      await app.inject({
        method: "GET",
        url: `/api/v1/shipments/${shipmentId}/awb`,
        headers: other,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/v1/shipments/${shipmentId}/cancel`,
        headers: other,
      })
    ).statusCode,
  ).toBe(404);
  const pdf = await app.inject({
    method: "POST",
    url: "/api/v1/shipments/awb",
    headers,
    payload: { orderIds: [orderId] },
  });
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers["content-type"]).toContain("application/pdf");
  expect(pdf.headers["cache-control"]).toBe("private, no-store");
  expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  const cancelHandler = vi.spyOn(CarrierShippingAdminController.prototype, "cancel");
  const detach = vi.spyOn(CarrierFulfillmentAdapter.prototype, "detach");
  try {
    for (const payload of [{ cod: 999 }, { amount: 999 }]) {
      const rejected = await app.inject({
        method: "POST",
        url: `/api/v1/shipments/${shipmentId}/cancel`,
        headers,
        payload,
      });
      expect(rejected.statusCode, rejected.body).toBe(422);
      expect(rejected.json()).toMatchObject({ code: "VALIDATION" });
      expect(cancelHandler).not.toHaveBeenCalled();
      expect(detach).not.toHaveBeenCalled();
      expect(fake.record.cancelCalls).toHaveLength(0);
    }
  } finally {
    cancelHandler.mockRestore();
    detach.mockRestore();
  }
  const cancel = await app.inject({
    method: "POST",
    url: `/api/v1/shipments/${shipmentId}/cancel`,
    headers,
  });
  expect(cancel.statusCode, cancel.body).toBe(200);
  const emptyBodyCancel = await app.inject({
    method: "POST",
    url: `/api/v1/shipments/${shipmentId}/cancel`,
    headers,
    payload: {},
  });
  expect(emptyBodyCancel.statusCode, emptyBodyCancel.body).toBe(200);
  const orderCarrier = await app.inject({
    method: "GET",
    url: `/api/v1/orders/${orderId}/carrier-shipment`,
    headers,
  });
  expect(orderCarrier.json().shipment.status).toBe("voided");
  const reship = await app.inject({
    method: "POST",
    url: `/api/v1/orders/${orderId}/carrier-shipments`,
    headers,
    payload: { carrierKey: "bosta" },
  });
  expect(reship.statusCode, reship.body).toBe(200);
  expect(fake.record.createCalls[1]?.request.reference).toBe(`${placed.json().orderNumber}-2`);
  expect(fake.record.cancelCalls).toHaveLength(1);
});

it("another tenant's shipment is not available for AWB or cancel", async () => {
  const awb = await app.inject({
    method: "GET",
    url: "/api/v1/shipments/missing/awb",
    headers: { ...headers, "x-tenant-id": "t-2" },
  });
  const cancel = await app.inject({
    method: "POST",
    url: "/api/v1/shipments/missing/cancel",
    headers: { ...headers, "x-tenant-id": "t-2" },
  });
  expect(awb.statusCode).toBe(404);
  expect(cancel.statusCode).toBe(404);
});
