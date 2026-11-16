import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireFulfillment, type FulfillmentOrder } from "@platform/fulfillment";
import { InMemoryCarrierCredentialVault, wireShipping } from "@platform/shipping";
import { fakeRegistration } from "@platform/shipping/testing";
import { CarrierFulfillmentAdapter } from "./carrier-fulfillment.adapter";
import type { CarrierOrderReader } from "./ports";
import { ShipOrderWithCarrier } from "./ship-order-with-carrier";
import { CarrierShippingAdminController } from "../interfaces/carrier-shipping.admin-controller";
import type { AdminGuard } from "../interfaces/admin-guard";
import { publicCarrierWebhookRoutes } from "../http/public-carrier-webhook-routes";

beforeEach(() => {
  expect.hasAssertions();
});

async function harness() {
  let tick = 0;
  const deps = {
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: randomUUID },
    clock: { now: () => new Date(1794520800000 + tick++) },
  };
  const fake = fakeRegistration();
  const { shipping } = wireShipping({
    ...deps,
    randomSecret: () => "review-secret",
    carrierRegistrations: [fake.registration],
    carrierCredentialVault: new InMemoryCarrierCredentialVault(),
  });
  const { fulfillment } = wireFulfillment(deps);
  const adapter = new CarrierFulfillmentAdapter(fulfillment);
  const orders: CarrierOrderReader = {
    read: () =>
      Promise.resolve({
        orderId: "o-1",
        orderNumber: "1001",
        open: true,
        paymentStatus: "paid",
        totalMinor: 10000,
        currency: "EGP",
        shippingAddress: {
          recipientName: "Name",
          phone: "01000000000",
          line1: "1 Main Street",
          city: "Cairo",
          province: "EG-C",
          country: "EG",
        },
        items: [
          { productId: "p-1", name: "Shirt", quantity: 1, imageUrl: null, variantTitle: null },
        ],
      }),
    codIntent: () => Promise.resolve(null),
  };
  const shipper = new ShipOrderWithCarrier({ orders, fulfillment: adapter, shipping });
  const controller = new CarrierShippingAdminController({
    guard: { ensure: () => Promise.resolve(undefined) } as unknown as AdminGuard,
    orders,
    rawFulfillment: fulfillment,
    fulfillment: adapter,
    shipping,
    shipper,
  });
  expect(
    (
      await shipping.updateCarrierSettings({
        tenantId: "t-1",
        carrierKey: "bosta",
        enabled: true,
        credentials: { apiKey: "key" },
      })
    ).status,
  ).toBe(200);
  const input = { tenantId: "t-1", orderId: "o-1", carrierKey: "bosta", idempotencyKey: "key" };
  const principal = { id: "admin", kind: "staff", roles: ["admin"], tenantId: "t-1" } as Principal;
  const current = async () =>
    (await fulfillment.getByOrder({ tenantId: "t-1", orderRef: "o-1" })).body as FulfillmentOrder;
  return { shipping, fulfillment, adapter, shipper, controller, fake, input, principal, current };
}

it.each(["false", "throw"] as const)(
  "repairs %s cancel detach before replacement and delivered webhook",
  async (failure) => {
    const h = await harness();
    const first = await h.shipper.execute(h.input);
    if (!first.ok) throw new Error(first.code);
    const detach = vi.spyOn(h.adapter, "detach");
    if (failure === "false") detach.mockResolvedValueOnce(false);
    else detach.mockRejectedValueOnce(new Error("detach unavailable"));
    expect(
      (
        await h.controller.cancel(h.principal, {
          tenantId: "t-1",
          shipmentId: first.value.shipmentId,
        })
      ).status,
    ).toBe(200);
    expect((await h.current()).trackingNumber?.value).toBe(first.value.trackingNumber);
    expect(detach).toHaveBeenCalledWith(
      "t-1",
      (await h.current()).id.toString(),
      first.value.trackingNumber,
    );
    const replacement = await h.shipper.execute(h.input);
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) throw new Error(replacement.code);
    expect(replacement.value.trackingNumber).not.toBe(first.value.trackingNumber);
    expect(h.fake.record.createCalls).toHaveLength(2);
    const fulfillmentOrderId = (await h.current()).id.toString();
    const delayed = await h.fulfillment.detachCarrierShipment({
      tenantId: "t-1",
      fulfillmentOrderId,
      expectedTrackingNumber: first.value.trackingNumber,
    });
    expect(delayed.body).toMatchObject({ status: "tracking_assigned", changed: false });
    expect((await h.current()).trackingNumber?.value).toBe(replacement.value.trackingNumber);
    const route = publicCarrierWebhookRoutes({
      carrierWebhooks: {
        verify: h.shipping.verifyCarrierWebhook.bind(h.shipping),
        record: h.shipping.recordWebhook.bind(h.shipping),
        mirrorFulfillment: h.fulfillment.mirrorShipmentStatus.bind(h.fulfillment),
      },
    } as never)[0]!;
    const response = await route.handle({
      context: {
        tenantId: "t-1",
        headers: { authorization: "review-secret" },
        rawBody: Buffer.from(
          JSON.stringify({
            trackingNumber: replacement.value.trackingNumber,
            state: 45,
            type: "SEND",
            timeStamp: 1794520800000,
          }),
        ),
      },
    } as never);
    expect(response.status).toBe(200);
    const final = await h.current();
    expect(final.status.value).toBe("delivered");
    expect(final.trackingNumber?.value).toBe(replacement.value.trackingNumber);
  },
);

it("repairs a differing fulfillment tracking identity before reusing a label", async () => {
  const h = await harness();
  const first = await h.shipper.execute(h.input);
  if (!first.ok) throw new Error(first.code);
  const old = await h.current();
  const id = old.id.toString();
  expect(await h.adapter.detach("t-1", id, first.value.trackingNumber)).toBe(true);
  expect(await h.adapter.attach("t-1", id, "bosta", "other-delivery", "stale-tn")).toBe(true);
  const again = await h.shipper.execute(h.input);
  expect(again).toMatchObject({ ok: true, value: { trackingNumber: first.value.trackingNumber } });
  expect((await h.current()).trackingNumber?.value).toBe(first.value.trackingNumber);
  expect(h.fake.record.createCalls).toHaveLength(1);
});

it.each(["false", "throw"] as const)(
  "blocks a replacement when detach still %s",
  async (failure) => {
    const h = await harness();
    const first = await h.shipper.execute(h.input);
    if (!first.ok) throw new Error(first.code);
    const detach = vi.spyOn(h.adapter, "detach");
    if (failure === "false") detach.mockResolvedValue(false);
    else detach.mockRejectedValue(new Error("detach unavailable"));
    expect(
      (
        await h.controller.cancel(h.principal, {
          tenantId: "t-1",
          shipmentId: first.value.shipmentId,
        })
      ).status,
    ).toBe(200);
    expect(await h.shipper.execute(h.input)).toEqual({
      ok: false,
      code: "FULFILLMENT_DETACH_PENDING",
      httpStatus: 409,
      orderNumber: "1001",
    });
    expect(h.fake.record.createCalls).toHaveLength(1);
  },
);
