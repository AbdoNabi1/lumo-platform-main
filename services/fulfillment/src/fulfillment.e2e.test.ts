import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireFulfillment } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-12T00:00:00.000Z") };

function wire() {
  return wireFulfillment({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newFulfillmentOrderId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.fulfillment.create({
    orderRef: "order-1",
    items: [{ productRef: "product-1", quantity: 2 }],
  });
  expect(created.status).toBe(201);
  return (created.body as { fulfillmentOrderId: string }).fulfillmentOrderId;
}

describe("fulfillment (end to end)", () => {
  it("runs the full Sprint 4.9 lifecycle: create -> reserve -> pick -> pack -> ship -> deliver, publishing canonical events", async () => {
    const app = wire();
    const id = await newFulfillmentOrderId(app);

    const reserved = await app.fulfillment.reserve({ fulfillmentOrderId: id });
    expect(reserved.status).toBe(200);
    expect((reserved.body as { status: string }).status).toBe("confirmed");

    expect(
      (await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "picking_started" }))
        .status,
    ).toBe(200);
    expect(
      (await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "picking_completed" }))
        .status,
    ).toBe(200);
    expect(
      (await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "packing_started" }))
        .status,
    ).toBe(200);
    expect(
      (await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "packing_completed" }))
        .status,
    ).toBe(200);

    const shipped = await app.fulfillment.ship({ fulfillmentOrderId: id });
    expect(shipped.status).toBe(200);
    expect((shipped.body as { status: string }).status).toBe("tracking_assigned");

    expect(
      (await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "shipment_dispatched" }))
        .status,
    ).toBe(200);
    expect(
      (await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "in_transit" })).status,
    ).toBe(200);
    expect(
      (await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "out_for_delivery" }))
        .status,
    ).toBe(200);
    const delivered = await app.fulfillment.advance({
      fulfillmentOrderId: id,
      toStatus: "delivered",
    });
    expect(delivered.status).toBe(200);
    expect((delivered.body as { status: string }).status).toBe("delivered");

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("fulfillment.order.delivered");
    expect(app.deliveredEventTypes).toContain("fulfillment.order.shipment_created");
    expect(app.deliveredEventTypes).toContain("fulfillment.order.tracking_assigned");
  });

  it("getByOrder resolves the fulfillment order opened for an order (Phase A.30 admin panel)", async () => {
    const app = wire();
    const id = await newFulfillmentOrderId(app);

    const found = await app.fulfillment.getByOrder({ orderRef: "order-1" });
    expect(found.status).toBe(200);
    expect((found.body as { id: { toString(): string } }).id.toString()).toBe(id);

    const missing = await app.fulfillment.getByOrder({ orderRef: "order-does-not-exist" });
    expect(missing.status).toBe(404);
  });

  it("carrier-webhook idempotency: first processed, replay deduped", async () => {
    const app = wire();
    const id = await newFulfillmentOrderId(app);
    await app.fulfillment.reserve({ fulfillmentOrderId: id });
    await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "picking_started" });
    await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "picking_completed" });
    await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "packing_started" });
    await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "packing_completed" });
    await app.fulfillment.ship({ fulfillmentOrderId: id });
    await app.fulfillment.advance({ fulfillmentOrderId: id, toStatus: "shipment_dispatched" });

    const first = await app.fulfillment.recordWebhook({
      fulfillmentOrderId: id,
      carrier: "ups",
      eventId: "evt-webhook-1",
      kind: "in_transit",
    });
    expect(first.status).toBe(200);
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((first.body as { status: string }).status).toBe("in_transit");

    const replay = await app.fulfillment.recordWebhook({
      fulfillmentOrderId: id,
      carrier: "ups",
      eventId: "evt-webhook-1",
      kind: "in_transit",
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("rejects an illegal transition (409)", async () => {
    const app = wire();
    const id = await newFulfillmentOrderId(app);
    const response = await app.fulfillment.advance({
      fulfillmentOrderId: id,
      toStatus: "shipment_created",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown fulfillment order", async () => {
    const app = wire();
    const response = await app.fulfillment.advance({
      fulfillmentOrderId: "missing",
      toStatus: "reservation_requested",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an empty item list at creation (422)", async () => {
    const app = wire();
    const response = await app.fulfillment.create({ orderRef: "order-1", items: [] });
    expect(response.status).toBe(422);
  });
});
