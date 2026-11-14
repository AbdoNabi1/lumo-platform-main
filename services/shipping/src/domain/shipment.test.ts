import { beforeEach, describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { Shipment } from "./shipment";
import { ShipmentPackage } from "./value-objects/shipment-package";
import { Carrier, CarrierService } from "./value-objects/carrier";
import { ShippingLabel } from "./value-objects/shipping-label";
import { TrackingNumber } from "./value-objects/tracking-number";

function pkg(): ShipmentPackage {
  const result = ShipmentPackage.create("pkg-1", ["item-1"], 500);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function shipment(): Shipment {
  return Shipment.create(UniqueEntityId.from("ship-1"), "fulfillment-1", [pkg()]);
}

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("Shipment", () => {
  it("starts at created and raises no events until the first transition", () => {
    const s = shipment();
    expect(s.status.value).toBe("created");
    expect(s.pullDomainEvents()).toHaveLength(0);
  });

  it("runs the label -> carrier -> transit -> delivered walk, with varying event names", () => {
    const s = shipment();

    const label = ShippingLabel.create("label-1", "1Z999AA10123456784");
    const carrier = Carrier.create("ups");
    const service = CarrierService.create("ground");
    const tracking = TrackingNumber.create("1Z999AA10123456784");
    if (!label.ok || !carrier.ok || !service.ok || !tracking.ok) throw new Error("invalid fixture");

    s.createLabel(label.value, carrier.value, service.value, tracking.value, "evt-1", new Date(0));
    expect(s.status.value).toBe("label_created");
    let events = s.pullDomainEvents();
    expect(events[0]?.eventName).toBe("shipment.transitioned");

    s.acceptByCarrier("evt-2", new Date(0));
    expect(s.status.value).toBe("carrier_accepted");

    s.markInTransit("evt-3", new Date(0));
    s.addTrackingEvent("Arrived at facility", new Date(0), "Louisville, KY");
    events = s.pullDomainEvents();
    expect(events.some((e) => e.eventName === "shipment.transitioned")).toBe(true);
    expect(s.trackingEvents).toHaveLength(1);

    s.markOutForDelivery("evt-4", new Date(0));
    s.markDelivered("evt-5", new Date(1_000));
    expect(s.status.value).toBe("delivered");
    expect(s.deliveredAt).toEqual(new Date(1_000));

    s.close("evt-6", new Date(0));
    expect(s.status.value).toBe("closed");
  });

  it("rejects an illegal transition (e.g. created -> in_transit directly, 409)", () => {
    const s = shipment();
    expect(() => s.transition("in_transit", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("retries from a recoverable state back to its target", () => {
    const s = shipment();
    const label = ShippingLabel.create("label-1", "track-1");
    const carrier = Carrier.create("ups");
    const service = CarrierService.create("ground");
    const tracking = TrackingNumber.create("track-1");
    if (!label.ok || !carrier.ok || !service.ok || !tracking.ok) throw new Error("invalid fixture");
    s.createLabel(label.value, carrier.value, service.value, tracking.value, "evt-1", new Date(0));
    s.rejectByCarrier("address_invalid", "evt-2", new Date(0));
    expect(s.status.value).toBe("rejected");

    s.retry("evt-3", new Date(0));
    expect(s.status.value).toBe("created");
  });

  it("rejects retrying from a non-recoverable state", () => {
    const s = shipment();
    expect(() => s.retry("evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("cancels from created and closes the cancellation", () => {
    const s = shipment();
    s.cancel("evt-1", new Date(0));
    expect(s.status.value).toBe("cancelled");
    s.close("evt-2", new Date(0));
    expect(s.status.value).toBe("closed");
  });
});

describe("pending label attempts (§9a.5, Ruling 4)", () => {
  const at = new Date("2026-11-12T10:00:00.000Z");
  const later = new Date("2026-11-12T10:05:00.000Z");

  it("begins, reports and closes a pending attempt; references count up", () => {
    const s = shipment();
    expect(s.nextLabelReference("1001")).toBe("1001-1");
    s.beginLabelAttempt("1001-1", at);
    expect(s.pendingLabelAttempt()?.reference).toBe("1001-1");
    expect(() => s.beginLabelAttempt("1001-2", at)).toThrow(/pending/i);
    s.failLabelAttempt("1001-1", at);
    expect(s.pendingLabelAttempt()).toBeUndefined();
    expect(s.nextLabelReference("1001")).toBe("1001-2");
    expect(s.attempts.every((a) => /^[0-9a-f-]{36}$/.test(a.id.toString()))).toBe(true);
  });

  it("settles append-only: the pending row stays and a label row with the same reference follows", () => {
    const s = shipment();
    s.beginLabelAttempt("1001-1", at);
    s.failLabelAttempt("1001-1", later);
    expect(s.attempts.map((a) => [a.kind, a.outcome, a.reference])).toEqual([
      ["label", "pending", "1001-1"],
      ["label", "failed", "1001-1"],
    ]);
    expect(s.attempts[0]?.occurredAt).toEqual(at);
    expect(s.attempts[1]?.occurredAt).toEqual(later);
  });

  it("gives every attempt a distinct deterministic UUID (Ruling 7)", () => {
    const s = shipment();
    s.beginLabelAttempt("1001-1", at);
    s.failLabelAttempt("1001-1", at);
    const again = shipment();
    again.beginLabelAttempt("1001-1", at);
    again.failLabelAttempt("1001-1", at);
    const ids = s.attempts.map((a) => a.id.toString());
    expect(new Set(ids).size).toBe(2);
    expect(again.attempts.map((a) => a.id.toString())).toEqual(ids);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("refuses to begin when the status cannot reach label_created", () => {
    const s = shipment();
    s.cancel("evt-1", at);
    expect(() => s.beginLabelAttempt("1001-1", at)).toThrow(BusinessRuleError);
    expect(s.attempts).toHaveLength(0);
  });

  it("refuses to fail or park a reference that is not the open attempt", () => {
    const s = shipment();
    expect(() => s.failLabelAttempt("1001-1", at)).toThrow(BusinessRuleError);
    s.beginLabelAttempt("1001-1", at);
    expect(() => s.failLabelAttempt("1001-9", at)).toThrow(BusinessRuleError);
    expect(() => s.markCarrierResultUnknown("1001-9", "evt-2", at)).toThrow(BusinessRuleError);
    expect(s.status.value).toBe("created");
    expect(s.pendingLabelAttempt()?.reference).toBe("1001-1");
  });

  it("a labelled shipment closes the attempt with the same reference and keeps the delivery id", () => {
    const s = shipment();
    s.beginLabelAttempt("1001-1", at);
    const label = ShippingLabel.create("del-1", "5108002", "del-1");
    s.createLabel(
      unwrap(label),
      unwrap(Carrier.create("bosta")),
      unwrap(CarrierService.create("standard")),
      unwrap(TrackingNumber.create("5108002")),
      "evt-1",
      at,
      "1001-1",
    );
    expect(s.status.value).toBe("label_created");
    expect(s.label?.carrierDeliveryId).toBe("del-1");
    expect(s.pendingLabelAttempt()).toBeUndefined();
    expect(s.attempts.at(-1)?.outcome).toBe("succeeded");
    expect(s.attempts.at(-1)?.reference).toBe("1001-1");
  });

  it("the legacy label path records no reference and no delivery id", () => {
    const s = shipment();
    s.createLabel(
      unwrap(ShippingLabel.create("label-1", "track-1")),
      unwrap(Carrier.create("ups")),
      unwrap(CarrierService.create("ground")),
      unwrap(TrackingNumber.create("track-1")),
      "evt-1",
      at,
    );
    expect(s.label?.carrierDeliveryId).toBeUndefined();
    expect(s.attempts.at(-1)?.reference).toBeUndefined();
  });

  it("result unknown → exception needing review; retry closes the attempt and goes back to created", () => {
    const s = shipment();
    s.beginLabelAttempt("1001-1", at);
    s.markCarrierResultUnknown("1001-1", "evt-2", at);
    expect(s.status.value).toBe("exception");
    expect(s.needsCarrierReview).toBe(true);
    expect(s.pendingLabelAttempt()?.reference).toBe("1001-1");
    expect(s.attempts.at(-1)?.kind).toBe("carrier");
    expect(s.attempts.at(-1)?.outcome).toBe("failed");
    expect(s.attempts.at(-1)?.reference).toBe("CARRIER_RESULT_UNKNOWN:1001-1");
    s.retry("evt-3", at);
    expect(s.status.value).toBe("created");
    expect(s.needsCarrierReview).toBe(false);
    expect(s.pendingLabelAttempt()).toBeUndefined();
    expect(s.nextLabelReference("1001")).toBe("1001-2");
  });

  it("an exception without an open attempt does not need carrier review, and retry adds no label row", () => {
    const s = shipment();
    s.raiseException("manual", "evt-1", at);
    expect(s.status.value).toBe("exception");
    expect(s.needsCarrierReview).toBe(false);
    s.retry("evt-2", at);
    expect(s.status.value).toBe("created");
    expect(s.attempts.filter((a) => a.kind === "label")).toHaveLength(0);
  });

  it("an open attempt while created does not need carrier review", () => {
    const s = shipment();
    s.beginLabelAttempt("1001-1", at);
    expect(s.needsCarrierReview).toBe(false);
  });
});
