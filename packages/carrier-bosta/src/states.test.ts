import { beforeEach, describe, expect, it } from "vitest";
import { bostaScanText, mapBostaState, type BostaTarget } from "./states";

beforeEach(() => {
  expect.hasAssertions();
});

describe("Bosta states", () => {
  it.each<[number, string | undefined, BostaTarget | null]>([
    [10, "SEND", null],
    [11, "SEND", null],
    [20, "SEND", null],
    [21, "SEND", "in_transit"],
    [24, "SEND", "in_transit"],
    [30, "SEND", "in_transit"],
    [41, "SEND", "out_for_delivery"],
    [41, "RTO", null],
    [45, "SEND", "delivered"],
    [47, "SEND", "delivery_failed"],
    [46, "RTO", "returned"],
    [60, "FXF_SEND", "returned"],
    [48, "SEND", "cancelled"],
    [49, "SEND", "cancelled"],
    [100, "SEND", "exception"],
    [101, "SEND", "exception"],
    [102, "SEND", null],
    [999, "SEND", null],
    [24, "RTO", null],
    [47, "RTO", null],
    [24, undefined, "in_transit"],
    [30, "FXF_SEND", "in_transit"],
    [21, "CRP", null],
  ])("maps state %i and type %s", (state, type, target) => {
    expect(mapBostaState(state, type).target).toBe(target);
  });
  it.each<[number, string]>([
    [10, "Pickup requested"],
    [11, "Waiting for route"],
    [20, "Route assigned"],
    [21, "Picked up from business"],
    [22, "Picking up from consignee"],
    [23, "Picked up from consignee"],
    [24, "Received at warehouse"],
    [25, "Fulfilled"],
    [30, "In transit between hubs"],
    [40, "Picking up"],
    [41, "Out for delivery"],
    [45, "Delivered"],
    [46, "Returned to business"],
    [47, "Exception"],
    [48, "Terminated"],
    [49, "Canceled"],
    [60, "Returned to stock"],
    [100, "Lost"],
    [101, "Damaged"],
    [102, "Investigation"],
    [103, "Awaiting your action"],
    [104, "Archived"],
    [105, "On hold"],
    [999, "Bosta state 999"],
  ])("labels state %i", (state, label) => {
    expect(mapBostaState(state, "SEND").label).toBe(label);
  });
  it("labels return-direction 41 and safely clips exception scans", () => {
    expect(mapBostaState(41, "RTO").label).toBe("Out for return");
    expect(bostaScanText(24, "SEND", undefined)).toBe("Received at warehouse");
    expect(bostaScanText(47, "SEND", "Postponed")).toBe("Exception: Postponed");
    expect(bostaScanText(47, "SEND", "")).toBe("Exception");
    expect(bostaScanText(47, "SEND", "x".repeat(300))).toHaveLength(200);
    expect(bostaScanText(999, "SEND", undefined)).toBe("Bosta state 999");
  });
});
