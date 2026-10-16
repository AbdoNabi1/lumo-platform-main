import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Shipment } from "../domain/shipment";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
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
    await assertWriteTimeTenant("shipping", async (outbox, tenantId) => {
      const shipments = new InMemoryShipmentRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      const shipment = newShipment("ship-1", "fulfillment-1");
      shipment.transition("label_created", "evt-1", new Date(0));
      await shipments.save(shipment, tenantId);
    });
  });
});
