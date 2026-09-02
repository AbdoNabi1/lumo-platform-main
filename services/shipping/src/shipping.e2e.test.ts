import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireShipping } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-12T00:00:00.000Z") };

function wire() {
  return wireShipping({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newShipmentId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.shipping.create({
    fulfillmentRef: "fulfillment-1",
    packages: [{ reference: "pkg-1", itemRefs: ["item-1"], weightGrams: 500 }],
  });
  expect(created.status).toBe(201);
  return (created.body as { shipmentId: string }).shipmentId;
}

describe("shipping (end to end)", () => {
  it("runs the full Sprint 4.10 lifecycle: create -> label -> carrier -> transit -> deliver, publishing canonical events", async () => {
    const app = wire();
    const id = await newShipmentId(app);

    const labeled = await app.shipping.createLabel({ shipmentId: id });
    expect(labeled.status).toBe(200);
    expect((labeled.body as { status: string }).status).toBe("label_created");

    expect(
      (await app.shipping.advance({ shipmentId: id, toStatus: "carrier_accepted" })).status,
    ).toBe(200);
    expect((await app.shipping.advance({ shipmentId: id, toStatus: "in_transit" })).status).toBe(
      200,
    );

    const tracked = await app.shipping.updateTracking({
      shipmentId: id,
      description: "Arrived at facility",
      location: "Louisville, KY",
    });
    expect(tracked.status).toBe(200);

    expect(
      (await app.shipping.advance({ shipmentId: id, toStatus: "out_for_delivery" })).status,
    ).toBe(200);
    const delivered = await app.shipping.advance({ shipmentId: id, toStatus: "delivered" });
    expect(delivered.status).toBe(200);
    expect((delivered.body as { status: string }).status).toBe("delivered");

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("shipping.label.created");
    expect(app.deliveredEventTypes).toContain("shipping.carrier.accepted");
    expect(app.deliveredEventTypes).toContain("shipping.tracking.updated");
    expect(app.deliveredEventTypes).toContain("shipping.shipment.delivered");
  });

  it("getByFulfillment resolves the shipment opened for a fulfillment order (Phase A.30 admin panel)", async () => {
    const app = wire();
    const id = await newShipmentId(app);

    const found = await app.shipping.getByFulfillment({ fulfillmentRef: "fulfillment-1" });
    expect(found.status).toBe(200);
    expect((found.body as { id: { toString(): string } }).id.toString()).toBe(id);

    const missing = await app.shipping.getByFulfillment({
      fulfillmentRef: "fulfillment-does-not-exist",
    });
    expect(missing.status).toBe(404);
  });

  it("voids a label and re-creates a new one", async () => {
    const app = wire();
    const id = await newShipmentId(app);
    await app.shipping.createLabel({ shipmentId: id });

    const voided = await app.shipping.voidLabel({ shipmentId: id });
    expect(voided.status).toBe(200);
    expect((voided.body as { status: string }).status).toBe("voided");

    const recreated = await app.shipping.advance({ shipmentId: id, toStatus: "created" });
    expect(recreated.status).toBe(200);
    const relabeled = await app.shipping.createLabel({ shipmentId: id });
    expect(relabeled.status).toBe(200);
    expect((relabeled.body as { status: string }).status).toBe("label_created");
  });

  it("carrier-webhook idempotency: first processed, replay deduped", async () => {
    const app = wire();
    const id = await newShipmentId(app);
    await app.shipping.createLabel({ shipmentId: id });

    const first = await app.shipping.recordWebhook({
      shipmentId: id,
      carrier: "ups",
      eventId: "evt-webhook-1",
      kind: "accepted",
    });
    expect(first.status).toBe(200);
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((first.body as { status: string }).status).toBe("carrier_accepted");

    const replay = await app.shipping.recordWebhook({
      shipmentId: id,
      carrier: "ups",
      eventId: "evt-webhook-1",
      kind: "accepted",
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("rejects an illegal transition (409)", async () => {
    const app = wire();
    const id = await newShipmentId(app);
    const response = await app.shipping.advance({ shipmentId: id, toStatus: "in_transit" });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown shipment", async () => {
    const app = wire();
    const response = await app.shipping.advance({
      shipmentId: "missing",
      toStatus: "label_created",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an empty package list at creation (422)", async () => {
    const app = wire();
    const response = await app.shipping.create({ fulfillmentRef: "fulfillment-1", packages: [] });
    expect(response.status).toBe(422);
  });
});
