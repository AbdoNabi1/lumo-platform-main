import { beforeEach, describe, expect, it } from "vitest";
import { canTransitionShipment, carrierPathTo } from "./shipment-status";

beforeEach(() => {
  expect.hasAssertions();
});

describe("§9a.4 additive transitions", () => {
  it.each([
    ["in_transit", "returned"],
    ["out_for_delivery", "returned"],
    ["delivery_failed", "returned"],
    ["exception", "returned"],
    ["in_transit", "delivery_failed"],
    ["carrier_accepted", "cancelled"],
    ["in_transit", "cancelled"],
    ["created", "exception"],
  ] as const)("%s → %s is allowed", (from, to) => {
    expect(canTransitionShipment(from, to)).toBe(true);
  });
  it("keeps every pre-existing edge", () => {
    expect(canTransitionShipment("delivered", "returned")).toBe(true);
    expect(canTransitionShipment("voided", "created")).toBe(true);
    expect(canTransitionShipment("exception", "created")).toBe(true);
  });
});

describe("carrierPathTo (Ruling 23)", () => {
  it("walks missed steps forward", () => {
    expect(carrierPathTo("label_created", "delivered")).toEqual([
      "carrier_accepted",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ]);
    expect(carrierPathTo("label_created", "in_transit")).toEqual([
      "carrier_accepted",
      "in_transit",
    ]);
    expect(carrierPathTo("label_created", "returned")).toEqual([
      "carrier_accepted",
      "in_transit",
      "returned",
    ]);
  });
  it("is [] for the same status and null when unreachable", () => {
    expect(carrierPathTo("in_transit", "in_transit")).toEqual([]);
    expect(carrierPathTo("delivered", "in_transit")).toBeNull();
    expect(carrierPathTo("voided", "delivered")).toBeNull();
  });
  it("reaches cancelled and exception only by a direct edge", () => {
    expect(carrierPathTo("in_transit", "cancelled")).toEqual(["cancelled"]);
    expect(carrierPathTo("delivery_failed", "cancelled")).toBeNull();
    expect(carrierPathTo("label_created", "exception")).toBeNull();
    expect(carrierPathTo("in_transit", "exception")).toEqual(["exception"]);
  });
});
