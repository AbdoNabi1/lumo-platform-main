import { UniqueEntityId } from "@platform/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { Shipment } from "../domain/shipment";
import { Carrier, CarrierService } from "../domain/value-objects/carrier";
import type { ShipmentStatusValue } from "../domain/value-objects/shipment-status";
import { ShipmentPackage } from "../domain/value-objects/shipment-package";
import { ShippingLabel } from "../domain/value-objects/shipping-label";
import { TrackingNumber } from "../domain/value-objects/tracking-number";
import { InMemoryProcessedCarrierWebhookStore } from "../infrastructure/in-memory-port-adapters";
import { fixedClock, sequentialIds } from "../testing/carrier-doubles";
import { PostgresLikeShipmentRepository, TrackingUnitOfWork } from "../testing/shipping-doubles";
import { RecordCarrierWebhook } from "./record-carrier-webhook.use-case";

beforeEach(() => {
  expect.hasAssertions();
});

const T = "t-1";
const NUMBER = "5108002";
const WALK: readonly ShipmentStatusValue[] = [
  "carrier_accepted",
  "in_transit",
  "out_for_delivery",
  "delivered",
];

async function addShipment(
  shipments: PostgresLikeShipmentRepository,
  options: { id: string; fulfillmentRef: string; walkTo?: ShipmentStatusValue; number?: string },
  tenantId = T,
): Promise<void> {
  const pkg = ShipmentPackage.create(`p-${options.id}`, ["item"], 1);
  const carrier = Carrier.create("bosta");
  const service = CarrierService.create("standard");
  const number = options.number ?? NUMBER;
  const label = ShippingLabel.create(`del-${options.id}`, number, `del-${options.id}`);
  const tracking = TrackingNumber.create(number);
  if (!pkg.ok || !carrier.ok || !service.ok || !label.ok || !tracking.ok)
    throw new Error("fixture");
  const at = new Date("2026-11-12T10:00:00.000Z");
  const shipment = Shipment.create(UniqueEntityId.from(options.id), options.fulfillmentRef, [
    pkg.value,
  ]);
  shipment.beginLabelAttempt("1001-1", at);
  shipment.createLabel(
    label.value,
    carrier.value,
    service.value,
    tracking.value,
    "e",
    at,
    "1001-1",
  );
  if (options.walkTo !== undefined) {
    for (const step of WALK) {
      shipment.transition(step, `walk-${step}`, at);
      if (step === options.walkTo) break;
    }
  }
  await shipments.save(shipment, tenantId);
}

async function webhookHarness(options: { status?: ShipmentStatusValue; failSave?: boolean } = {}) {
  const shipments = new PostgresLikeShipmentRepository();
  const store = new InMemoryProcessedCarrierWebhookStore();
  const clock = fixedClock();
  const walkTo =
    options.status === undefined || options.status === "label_created" ? undefined : options.status;
  await addShipment(shipments, { id: "s1", fulfillmentRef: "f1", walkTo });
  let failing = options.failSave === true;
  const repository = new Proxy(shipments, {
    get(target, property, receiver) {
      if (property === "save") {
        return (...args: Parameters<PostgresLikeShipmentRepository["save"]>) =>
          failing ? Promise.reject(new Error("db down")) : target.save(...args);
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const record = new RecordCarrierWebhook({
    shipments: repository,
    unitOfWork: new TrackingUnitOfWork(),
    idGenerator: sequentialIds(),
    clock,
    processedCarrierWebhooks: store,
  });
  return {
    record,
    shipments,
    store,
    clock,
    heal: () => {
      failing = false;
    },
    shipment: async () => {
      const found = await shipments.findById("s1", T);
      if (found === null) throw new Error("missing");
      return found;
    },
  };
}

const scanAt = (description: string, ms = 1700000000000) => ({
  description,
  occurredAt: new Date(ms),
});

describe("RecordCarrierWebhook with carrier statuses (§8.5, §9a.4, Ruling 23)", () => {
  it("adds a scan for every accepted webhook, and walks label_created → delivered after missed webhooks", async () => {
    const h = await webhookHarness();
    const r = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "5108002:45:1700000000000",
      kind: "45",
      toStatus: "delivered",
      scan: scanAt("Delivered"),
    });
    expect(r.ok && r.value.transitions).toEqual([
      "carrier_accepted",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ]);
    const s = await h.shipment();
    expect(s.deliveredAt?.getTime()).toBe(1700000000000);
    expect(s.trackingEvents.map((e) => e.description)).toEqual(["Delivered"]);
  });

  it("an impossible transition is a scan only and never throws", async () => {
    const h = await webhookHarness({ status: "delivered" });
    const r = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-1",
      kind: "21",
      toStatus: "in_transit",
      scan: scanAt("Picked up"),
    });
    expect(r.ok && r.value).toMatchObject({ status: "delivered", transitions: [] });
    expect((await h.shipment()).trackingEvents).toHaveLength(1);
  });

  it("the same event id twice is a duplicate with no second scan", async () => {
    const h = await webhookHarness();
    const input = {
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-dup",
      kind: "21",
      toStatus: "in_transit" as const,
      scan: scanAt("Picked up"),
    };
    const first = await h.record.execute(input);
    const second = await h.record.execute(input);
    expect(first.ok && first.value.duplicate).toBe(false);
    expect(second.ok && second.value).toMatchObject({ duplicate: true, transitions: [] });
    expect((await h.shipment()).trackingEvents).toHaveLength(1);
  });

  it("a tracking number of another tenant is NOT_FOUND", async () => {
    const h = await webhookHarness();
    const r = await h.record.execute({
      tenantId: "t-2",
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-1",
      kind: "21",
    });
    expect(!r.ok && r.error.code).toBe("NOT_FOUND");
  });

  it("delivery_failed records the exception reason on the attempt", async () => {
    const h = await webhookHarness({ status: "out_for_delivery" });
    const r = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-1",
      kind: "47",
      toStatus: "delivery_failed",
      reason: "Postponed by customer",
      scan: scanAt("Exception: Postponed by customer"),
    });
    expect(r.ok && r.value.transitions).toEqual(["delivery_failed"]);
    const last = (await h.shipment()).attempts.at(-1);
    expect(last).toMatchObject({
      kind: "carrier",
      outcome: "failed",
      reference: "Postponed by customer",
    });
  });

  it("a save that throws leaves the event unprocessed", async () => {
    const h = await webhookHarness({ failSave: true });
    const input = {
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-fail",
      kind: "21",
      toStatus: "in_transit" as const,
      scan: scanAt("Picked up"),
    };
    await expect(h.record.execute(input)).rejects.toThrow("db down");
    expect(await h.store.hasProcessed("bosta", "e-fail", T)).toBe(false);
    h.heal();
    const retried = await h.record.execute(input);
    expect(retried.ok && retried.value.duplicate).toBe(false);
  });

  it("a scan on a created shipment changes nothing else", async () => {
    const h = await webhookHarness();
    const s = await h.shipment();
    // rejected → retry leaves a `created` shipment that still carries its old tracking number.
    s.rejectByCarrier("refused", "reject", new Date());
    s.retry("retry", new Date());
    await h.shipments.save(s, T);
    const r = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-1",
      kind: "21",
      toStatus: "in_transit",
      scan: scanAt("Picked up"),
    });
    expect(r.ok && r.value).toMatchObject({ status: "created", transitions: [] });
    expect((await h.shipment()).trackingEvents).toHaveLength(1);
  });

  it("uses the scan time for every step, else the clock", async () => {
    const h = await webhookHarness();
    await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-1",
      kind: "21",
      toStatus: "in_transit",
      scan: scanAt("Picked up", 1700000005000),
    });
    const s = await h.shipment();
    expect(s.trackingEvents[0]?.occurredAt.getTime()).toBe(1700000005000);
    const legacy = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      shipmentId: "s1",
      eventId: "e-2",
      kind: "out_for_delivery",
    });
    expect(legacy.ok && legacy.value.transitions).toEqual(["out_for_delivery"]);
  });

  it("returns carrier, tracking number and delivery id for the mirror", async () => {
    const h = await webhookHarness();
    const r = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      shipmentId: "s1",
      eventId: "e-1",
      kind: "accepted",
    });
    expect(r.ok && r.value).toMatchObject({
      shipmentId: "s1",
      fulfillmentRef: "f1",
      carrier: "bosta",
      trackingNumber: NUMBER,
      carrierDeliveryId: "del-s1",
      isCurrentShipment: true,
      transitions: ["carrier_accepted"],
    });
  });

  it("requires exactly one of shipmentId and trackingNumber", async () => {
    const h = await webhookHarness();
    const base = { tenantId: T, carrier: "bosta", eventId: "e", kind: "21" };
    const both = await h.record.execute({ ...base, shipmentId: "s1", trackingNumber: NUMBER });
    const neither = await h.record.execute(base);
    expect(!both.ok && both.error.code).toBe("VALIDATION");
    expect(!neither.ok && neither.error.code).toBe("VALIDATION");
  });

  it("flags a webhook for an older shipment as not current and leaves the newer one alone", async () => {
    const h = await webhookHarness();
    // A (older) is cancelled, B (newer) is live under the same fulfillment.
    await addShipment(h.shipments, { id: "s2", fulfillmentRef: "f1", number: "7777" });
    const oldA = await h.shipment();
    oldA.cancel("cancel", new Date());
    await h.shipments.save(oldA, T);
    const r = await h.record.execute({
      tenantId: T,
      carrier: "bosta",
      trackingNumber: NUMBER,
      eventId: "e-1",
      kind: "48",
      scan: scanAt("Cancelled"),
    });
    expect(r.ok && r.value).toMatchObject({ shipmentId: "s1", isCurrentShipment: false });
    const b = await h.shipments.findById("s2", T);
    expect(b?.trackingEvents).toHaveLength(0);
    expect(b?.status.value).toBe("label_created");
    expect((await h.shipment()).trackingEvents).toHaveLength(1);
  });
});
