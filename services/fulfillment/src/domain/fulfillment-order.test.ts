import { beforeEach, describe, expect, it } from "vitest";
import { BusinessRuleError, ProductRef, UniqueEntityId } from "@platform/domain";
import { FulfillmentOrder } from "./fulfillment-order";
import { FulfillmentItem } from "./value-objects/fulfillment-item";
import { CarrierReference, TrackingNumber } from "./value-objects/fulfillment-refs";

function productRef(value: string): ProductRef {
  const result = ProductRef.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function item(): FulfillmentItem {
  const result = FulfillmentItem.create(productRef("product-1"), 2);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

beforeEach(() => {
  expect.hasAssertions();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function labelledOrder(tracked: boolean): FulfillmentOrder {
  const order = FulfillmentOrder.create(UniqueEntityId.from("ff-1"), "order-1", [item()]);
  order.requestReservation("e1", new Date(0));
  order.confirmReservation("e2", new Date(0));
  order.startPicking("e3", new Date(0));
  order.completePicking("e4", new Date(0));
  order.startPacking("e5", new Date(0));
  order.completePacking("e6", new Date(0));
  const ref = CarrierReference.create("bosta", "del-1");
  const tracking = TrackingNumber.create("5108002");
  if (!ref.ok || !tracking.ok) throw new Error("invalid fixture");
  order.createShipment(ref.value, "e7", new Date(0));
  if (tracked) order.assignTracking(tracking.value, "e8", new Date(0));
  order.pullDomainEvents();
  return order;
}

function fulfillmentOrder(): FulfillmentOrder {
  return FulfillmentOrder.create(UniqueEntityId.from("ff-1"), "order-1", [item()]);
}

describe("FulfillmentOrder", () => {
  it("starts at created and raises no events until the first transition", () => {
    const order = fulfillmentOrder();
    expect(order.status.value).toBe("created");
    expect(order.pullDomainEvents()).toHaveLength(0);

    order.requestReservation("evt-1", new Date(0));
    expect(order.status.value).toBe("reservation_requested");
    const events = order.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("fulfillment.transitioned");
  });

  it("runs the full Sprint 4.9 happy-path lifecycle: created -> ... -> delivered -> closed", () => {
    const order = fulfillmentOrder();

    order.requestReservation("evt-1", new Date(0));
    order.confirmReservation("evt-2", new Date(0));
    expect(order.status.value).toBe("confirmed");

    order.startPicking("evt-3", new Date(0));
    order.completePicking("evt-4", new Date(0));
    expect(order.status.value).toBe("picking_completed");

    order.startPacking("evt-5", new Date(0));
    order.completePacking("evt-6", new Date(0));
    expect(order.status.value).toBe("packing_completed");

    const carrierRef = CarrierReference.create("ups", "1Z-shipment-1");
    if (!carrierRef.ok) throw new Error("invalid fixture");
    order.createShipment(carrierRef.value, "evt-7", new Date(0));
    expect(order.status.value).toBe("shipment_created");
    expect(order.carrierReference?.carrier).toBe("ups");

    const tracking = TrackingNumber.create("1Z999AA10123456784");
    if (!tracking.ok) throw new Error("invalid fixture");
    order.assignTracking(tracking.value, "evt-8", new Date(0));
    expect(order.status.value).toBe("tracking_assigned");

    order.dispatch("evt-9", new Date(0));
    order.markInTransit("evt-10", new Date(0));
    order.markOutForDelivery("evt-11", new Date(0));
    order.markDelivered("evt-12", new Date(1_000));
    expect(order.status.value).toBe("delivered");
    expect(order.deliveredAt).toEqual(new Date(1_000));

    order.close("evt-13", new Date(0));
    expect(order.status.value).toBe("closed");
  });

  it("rejects an illegal transition (e.g. created -> shipment_created directly, 409)", () => {
    const order = fulfillmentOrder();
    expect(() => order.transition("shipment_created", "evt-1", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("cancels from created and closes the cancellation", () => {
    const order = fulfillmentOrder();
    order.cancel("evt-1", new Date(0));
    expect(order.status.value).toBe("cancelled");
    order.close("evt-2", new Date(0));
    expect(order.status.value).toBe("closed");
  });

  it("attempt ids are valid UUIDs after requestReservation", () => {
    const order = fulfillmentOrder();
    order.requestReservation("evt-1", new Date(0));
    order.failReservation("no stock", "evt-2", new Date(0));
    expect(order.attempts).toHaveLength(2);
    for (const attempt of order.attempts) {
      expect(attempt.id.toString()).toMatch(UUID);
    }
    expect(order.attempts[0]?.id.toString()).not.toBe(order.attempts[1]?.id.toString());
  });

  describe("returnToPacking (label voided, 9a.3)", () => {
    it("clears the carrier reference and tracking number from tracking_assigned", () => {
      const order = labelledOrder(true);
      order.returnToPacking("evt-r", new Date(1));
      expect(order.status.value).toBe("packing_completed");
      expect(order.carrierReference).toBeUndefined();
      expect(order.trackingNumber).toBeUndefined();
      expect(order.pullDomainEvents()).toHaveLength(1);
    });

    it("also works from shipment_created", () => {
      const order = labelledOrder(false);
      order.returnToPacking("evt-r", new Date(1));
      expect(order.status.value).toBe("packing_completed");
      expect(order.carrierReference).toBeUndefined();
    });

    it("refuses once the parcel is dispatched and keeps the label", () => {
      const order = labelledOrder(true);
      order.dispatch("evt-d", new Date(1));
      expect(() => order.returnToPacking("evt-r", new Date(2))).toThrow(BusinessRuleError);
      expect(order.trackingNumber?.value).toBe("5108002");
      expect(order.carrierReference?.carrierShipmentId).toBe("del-1");
    });
  });
});
