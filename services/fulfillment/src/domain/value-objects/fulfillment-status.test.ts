import { beforeEach, describe, expect, it } from "vitest";
import {
  canTransitionFulfillment,
  FulfillmentStatus,
  fulfillmentCarrierPathTo,
} from "./fulfillment-status";

beforeEach(() => {
  expect.hasAssertions();
});

describe("FulfillmentStatus (additive carrier edges, spec 9a)", () => {
  it.each([
    ["shipment_created", "packing_completed"],
    ["tracking_assigned", "packing_completed"],
    ["in_transit", "returned"],
    ["out_for_delivery", "returned"],
  ] as const)("%s -> %s is now allowed", (from, to) => {
    expect(canTransitionFulfillment(from, to)).toBe(true);
  });

  it("keeps the original edges and does not open dispatched -> packing_completed", () => {
    expect(canTransitionFulfillment("packing_completed", "shipment_created")).toBe(true);
    expect(canTransitionFulfillment("shipment_dispatched", "packing_completed")).toBe(false);
    expect(canTransitionFulfillment("delivered", "packing_completed")).toBe(false);
  });

  it("wraps a value and rehydrates it", () => {
    expect(FulfillmentStatus.created().value).toBe("created");
    expect(FulfillmentStatus.from("delivered").value).toBe("delivered");
  });
});

describe("fulfillmentCarrierPathTo", () => {
  it.each([
    ["tracking_assigned", "shipment_dispatched", ["shipment_dispatched"]],
    ["tracking_assigned", "in_transit", ["shipment_dispatched", "in_transit"]],
    [
      "tracking_assigned",
      "delivered",
      ["shipment_dispatched", "in_transit", "out_for_delivery", "delivered"],
    ],
    ["shipment_dispatched", "out_for_delivery", ["in_transit", "out_for_delivery"]],
    ["in_transit", "returned", ["returned"]],
    ["in_transit", "delivery_failed", ["delivery_failed"]],
    ["delivery_failed", "in_transit", ["in_transit"]],
    ["in_transit", "in_transit", []],
  ] as const)("%s -> %s walks %j", (from, to, expected) => {
    expect(fulfillmentCarrierPathTo(from, to)).toEqual(expected);
  });

  it("never walks backwards or invents a delivery failure", () => {
    expect(fulfillmentCarrierPathTo("out_for_delivery", "in_transit")).toBeNull();
    expect(fulfillmentCarrierPathTo("delivered", "in_transit")).toBeNull();
    expect(fulfillmentCarrierPathTo("in_transit", "shipment_dispatched")).toBeNull();
  });

  it("is unreachable before an attached label and for non-walk targets", () => {
    expect(fulfillmentCarrierPathTo("packing_completed", "in_transit")).toBeNull();
    expect(fulfillmentCarrierPathTo("confirmed", "delivered")).toBeNull();
    expect(fulfillmentCarrierPathTo("in_transit", "cancelled")).toBeNull();
  });
});
