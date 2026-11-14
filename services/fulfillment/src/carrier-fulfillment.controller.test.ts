import { beforeEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireFulfillment } from "./composition";

beforeEach(() => {
  expect.hasAssertions();
});

const T = "tenant-a";
const clock: Clock = { now: () => new Date("2026-11-12T10:00:00.000Z") };

function app() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireFulfillment({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

async function created(wired: ReturnType<typeof app>, tenantId = T): Promise<string> {
  const response = await wired.fulfillment.create({
    tenantId,
    orderRef: "order-1",
    items: [{ productRef: "product-1", quantity: 1 }],
  });
  return (response.body as { fulfillmentOrderId: string }).fulfillmentOrderId;
}

describe("carrier methods on FulfillmentController (wireFulfillment, in-memory)", () => {
  it("prepare, attach, mirror and detach round-trip with 200 responses", async () => {
    const wired = app();
    const id = await created(wired);

    const prepared = await wired.fulfillment.prepareForCarrier({
      tenantId: T,
      fulfillmentOrderId: id,
    });
    expect(prepared).toEqual({
      status: 200,
      body: { fulfillmentOrderId: id, status: "packing_completed" },
    });

    const attached = await wired.fulfillment.attachCarrierShipment({
      tenantId: T,
      fulfillmentOrderId: id,
      carrier: "bosta",
      carrierShipmentId: "del-1",
      trackingNumber: "5108002",
    });
    expect(attached.status).toBe(200);
    expect(attached.body).toMatchObject({ status: "tracking_assigned" });

    const mirrored = await wired.fulfillment.mirrorShipmentStatus({
      tenantId: T,
      fulfillmentOrderId: id,
      shipmentStatus: "in_transit",
    });
    expect(mirrored).toEqual({
      status: 200,
      body: { fulfillmentOrderId: id, status: "in_transit", changed: true },
    });

    const refused = await wired.fulfillment.detachCarrierShipment({
      tenantId: T,
      fulfillmentOrderId: id,
    });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("FULFILLMENT_ALREADY_DISPATCHED");
  });

  it("detach returns 200 and the order to packing_completed before pickup", async () => {
    const wired = app();
    const id = await created(wired);
    await wired.fulfillment.prepareForCarrier({ tenantId: T, fulfillmentOrderId: id });
    await wired.fulfillment.attachCarrierShipment({
      tenantId: T,
      fulfillmentOrderId: id,
      carrier: "bosta",
      carrierShipmentId: "del-1",
      trackingNumber: "5108002",
    });
    const detached = await wired.fulfillment.detachCarrierShipment({
      tenantId: T,
      fulfillmentOrderId: id,
    });
    expect(detached).toEqual({
      status: 200,
      body: { fulfillmentOrderId: id, status: "packing_completed" },
    });
    const events = await wired.drainOutbox();
    expect(events).toBeGreaterThan(0);
  });

  it("answers 404 for another tenant's order on every carrier method", async () => {
    const wired = app();
    const id = await created(wired);
    const other = "tenant-b";
    const responses = await Promise.all([
      wired.fulfillment.prepareForCarrier({ tenantId: other, fulfillmentOrderId: id }),
      wired.fulfillment.attachCarrierShipment({
        tenantId: other,
        fulfillmentOrderId: id,
        carrier: "bosta",
        carrierShipmentId: "del-1",
        trackingNumber: "5108002",
      }),
      wired.fulfillment.detachCarrierShipment({ tenantId: other, fulfillmentOrderId: id }),
      wired.fulfillment.mirrorShipmentStatus({
        tenantId: other,
        fulfillmentOrderId: id,
        shipmentStatus: "in_transit",
      }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });
});
