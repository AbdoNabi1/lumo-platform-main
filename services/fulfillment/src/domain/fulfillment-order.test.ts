import { describe, expect, it } from "vitest";
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
});
