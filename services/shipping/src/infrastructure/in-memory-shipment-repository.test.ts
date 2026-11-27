import { beforeEach, describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Shipment } from "../domain/shipment";
import { Carrier, CarrierService } from "../domain/value-objects/carrier";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { ShippingLabel } from "../domain/value-objects/shipping-label";
import { TrackingNumber } from "../domain/value-objects/tracking-number";
import { InMemoryProcessedCarrierWebhookStore } from "./in-memory-port-adapters";
import { InMemoryShipmentRepository } from "./in-memory-shipment-repository";
import { ShippingEventTranslator } from "./shipping-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function newShipment(id: string, fulfillmentRef: string): Shipment {
  const pkg = ShipmentPackage.create("pkg-1", ["item-1"], 500);
  if (!pkg.ok) throw new Error("test setup: invalid package");
  return Shipment.create(UniqueEntityId.from(id), fulfillmentRef, [pkg.value]);
}

function labelled(id: string, carrier: string, trackingNumber: string): Shipment {
  const shipment = newShipment(id, `fulfillment-${id}`);
  const label = ShippingLabel.create("del-1", trackingNumber, "del-1");
  const carrierVo = Carrier.create(carrier);
  const service = CarrierService.create("standard");
  const tracking = TrackingNumber.create(trackingNumber);
  if (!label.ok || !carrierVo.ok || !service.ok || !tracking.ok) {
    throw new Error("test setup: invalid label");
  }
  shipment.createLabel(
    label.value,
    carrierVo.value,
    service.value,
    tracking.value,
    "evt-1",
    new Date(0),
  );
  return shipment;
}

beforeEach(() => {
  expect.hasAssertions();
});

function repository() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new ShippingEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "shipping",
  });
  return new InMemoryShipmentRepository({ outbox, context: rootEventContext(sequentialIds()) });
}

describe("InMemoryShipmentRepository tenant isolation (ADR-0014, WP-10 T10.3)", () => {
  it("keeps the same shipment id and fulfillment ref separate per tenant", async () => {
    const shipments = repository();
    await shipments.save(newShipment("ship-shared-id", "fulfillment-shared"), "tenant-a");
    await shipments.save(newShipment("ship-shared-id", "fulfillment-shared"), "tenant-b");

    expect(await shipments.findById("ship-shared-id", "tenant-a")).not.toBeNull();
    expect(await shipments.findById("ship-shared-id", "tenant-b")).not.toBeNull();
    expect(await shipments.findById("ship-shared-id", "tenant-c")).toBeNull();
    expect(await shipments.findByFulfillmentRef("fulfillment-shared", "tenant-a")).not.toBeNull();
    expect(await shipments.findByFulfillmentRef("fulfillment-shared", "tenant-c")).toBeNull();
  });
});

describe("InMemoryProcessedCarrierWebhookStore tenant isolation (ADR-0014)", () => {
  it("does not treat another tenant's carrier event as already processed", async () => {
    const store = new InMemoryProcessedCarrierWebhookStore();
    await store.markProcessed("ups", "evt-1", "tenant-a");

    expect(await store.hasProcessed("ups", "evt-1", "tenant-a")).toBe(true);
    expect(await store.hasProcessed("ups", "evt-1", "tenant-b")).toBe(false);
  });
});

describe("InMemoryShipmentRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    const check = assertWriteTimeTenant("shipping", async (outbox, tenantId) => {
      const shipments = new InMemoryShipmentRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      const shipment = newShipment("ship-1", "fulfillment-1");
      shipment.transition("label_created", "evt-1", new Date(0));
      await shipments.save(shipment, tenantId);
    });
    await expect(check).resolves.toBeUndefined();
  });
});

describe("InMemoryShipmentRepository lookups (local carriers)", () => {
  it("counts only shipments for the given tenant and fulfillment", async () => {
    const shipments = repository();
    await shipments.save(newShipment("a", "f-1"), "t-1");
    await shipments.save(newShipment("b", "f-1"), "t-1");
    await shipments.save(newShipment("c", "f-2"), "t-1");
    await shipments.save(newShipment("d", "f-1"), "t-2");
    expect(await shipments.countByFulfillmentRef("f-1", "t-1")).toBe(2);
    expect(await shipments.countByFulfillmentRef("f-1", "t-2")).toBe(1);
    expect(await shipments.countByFulfillmentRef("f-1", "t-3")).toBe(0);
  });
  it("findByTrackingNumber is tenant- and carrier-scoped", async () => {
    const shipments = repository();
    await shipments.save(labelled("ship-bosta", "bosta", "5108002"), "t-1");

    const found = await shipments.findByTrackingNumber("bosta", "5108002", "t-1");
    expect(found?.id.toString()).toBe("ship-bosta");
    expect(await shipments.findByTrackingNumber("bosta", "5108002", "t-2")).toBeNull();
    expect(await shipments.findByTrackingNumber("aramex", "5108002", "t-1")).toBeNull();
    expect(await shipments.findByTrackingNumber("bosta", "0000000", "t-1")).toBeNull();
  });

  it("a re-labelled shipment is no longer found by the voided label's tracking number", async () => {
    const shipments = repository();
    const s = labelled("ship-bosta", "bosta", "5108002");
    s.voidLabel("evt-2", new Date(0));
    s.transition("created", "evt-3", new Date(0));
    await shipments.save(s, "t-1");
    // While re-shipping, the old number still matches (the walk refuses to move `created`).
    expect((await shipments.findByTrackingNumber("bosta", "5108002", "t-1"))?.status.value).toBe(
      "created",
    );

    const label = ShippingLabel.create("del-2", "5108999", "del-2");
    const carrier = Carrier.create("bosta");
    const service = CarrierService.create("standard");
    const tracking = TrackingNumber.create("5108999");
    if (!label.ok || !carrier.ok || !service.ok || !tracking.ok) throw new Error("invalid");
    s.createLabel(label.value, carrier.value, service.value, tracking.value, "evt-4", new Date(0));
    await shipments.save(s, "t-1");

    expect(await shipments.findByTrackingNumber("bosta", "5108002", "t-1")).toBeNull();
    expect((await shipments.findByTrackingNumber("bosta", "5108999", "t-1"))?.id.toString()).toBe(
      "ship-bosta",
    );
  });

  it("findByFulfillmentRef returns the newest shipment for the fulfillment (F4)", async () => {
    const shipments = repository();
    const first = newShipment("ship-old", "fulfillment-1");
    await shipments.save(first, "t-1");
    await shipments.save(newShipment("ship-new", "fulfillment-1"), "t-1");
    // Re-saving the older shipment does not make it the newest (Prisma orders by createdAt).
    first.cancel("evt-1", new Date(0));
    await shipments.save(first, "t-1");

    const found = await shipments.findByFulfillmentRef("fulfillment-1", "t-1");
    expect(found?.id.toString()).toBe("ship-new");
  });
});
