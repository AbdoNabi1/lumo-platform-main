import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
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
