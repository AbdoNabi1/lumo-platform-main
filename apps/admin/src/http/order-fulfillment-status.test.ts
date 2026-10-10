import { describe, expect, it } from "vitest";
import {
  deriveFulfillmentStatus,
  FULFILLMENT_STATUS_MAPPING,
  type FulfillmentFacts,
} from "./order-fulfillment-status";

function facts(
  status: string,
  extra: { deliveredAt?: Date; trackingNumber?: string } = {},
): FulfillmentFacts {
  return {
    status: { value: status },
    deliveredAt: extra.deliveredAt,
    trackingNumber:
      extra.trackingNumber === undefined ? undefined : { value: extra.trackingNumber },
  };
}

describe("deriveFulfillmentStatus (Plan 3B)", () => {
  it("is unfulfilled when no fulfillment order was opened for the order", () => {
    expect(deriveFulfillmentStatus(undefined)).toBe("unfulfilled");
  });

  // Every real value of Fulfillment's 18-value lifecycle (services/fulfillment FulfillmentStatusValue).
  it.each([
    // opened, reserved, picking, packing, shipment prepared but not yet handed to the carrier
    ["created", "in_progress"],
    ["reservation_requested", "in_progress"],
    ["confirmed", "in_progress"],
    ["picking_started", "in_progress"],
    ["picking_completed", "in_progress"],
    ["packing_started", "in_progress"],
    ["packing_completed", "in_progress"],
    ["shipment_created", "in_progress"],
    ["tracking_assigned", "in_progress"],
    // handed to the carrier / on the way
    ["shipment_dispatched", "fulfilled"],
    ["in_transit", "fulfilled"],
    ["out_for_delivery", "fulfilled"],
    ["delivery_failed", "fulfilled"],
    ["returned", "fulfilled"],
    // arrived
    ["delivered", "delivered"],
    // nothing is moving
    ["failed", "unfulfilled"],
    ["cancelled", "unfulfilled"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(deriveFulfillmentStatus(facts(status))).toBe(expected);
  });

  describe("closed is ambiguous on its own, so it reads what the fulfillment order recorded", () => {
    it("is delivered when the parcel was delivered", () => {
      expect(
        deriveFulfillmentStatus(
          facts("closed", { deliveredAt: new Date("2026-10-09"), trackingNumber: "T-1" }),
        ),
      ).toBe("delivered");
    });

    it("is fulfilled when it was shipped (it has a tracking number) but never delivered", () => {
      expect(deriveFulfillmentStatus(facts("closed", { trackingNumber: "T-1" }))).toBe("fulfilled");
    });

    it("is unfulfilled when it was closed before anything shipped (cancelled, then closed)", () => {
      expect(deriveFulfillmentStatus(facts("closed"))).toBe("unfulfilled");
    });
  });

  it("the documented mapping table lists every status exactly once", () => {
    const listed = FULFILLMENT_STATUS_MAPPING.map((row) => row.status);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(
      [
        "cancelled",
        "closed",
        "confirmed",
        "created",
        "delivered",
        "delivery_failed",
        "failed",
        "in_transit",
        "out_for_delivery",
        "packing_completed",
        "packing_started",
        "picking_completed",
        "picking_started",
        "reservation_requested",
        "returned",
        "shipment_created",
        "shipment_dispatched",
        "tracking_assigned",
      ].sort(),
    );
  });

  it("an unknown future status reads as in progress, never as shipped", () => {
    expect(deriveFulfillmentStatus(facts("some_new_status"))).toBe("in_progress");
  });
});
