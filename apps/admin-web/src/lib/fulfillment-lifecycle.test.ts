import { describe, expect, it } from "vitest";
import {
  advanceableFulfillmentStatusesFrom,
  canRecordFulfillmentWebhookFrom,
  canReserveFrom,
  canShipFrom,
  FULFILLMENT_LIFECYCLE_TRANSITIONS,
} from "./fulfillment-lifecycle";

describe("canReserveFrom", () => {
  it("is true at created and failed (both transition toward reservation_requested)", () => {
    expect(canReserveFrom("created")).toBe(true);
    expect(canReserveFrom("failed")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canReserveFrom("reservation_requested")).toBe(false);
    expect(canReserveFrom("confirmed")).toBe(false);
    expect(canReserveFrom("closed")).toBe(false);
  });
});

describe("canShipFrom", () => {
  it("is true only at packing_completed", () => {
    expect(canShipFrom("packing_completed")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canShipFrom("packing_started")).toBe(false);
    expect(canShipFrom("shipment_created")).toBe(false);
  });
});

describe("canRecordFulfillmentWebhookFrom", () => {
  it("is true for every non-terminal status", () => {
    for (const status of Object.keys(FULFILLMENT_LIFECYCLE_TRANSITIONS)) {
      if (status === "closed") continue;
      expect(canRecordFulfillmentWebhookFrom(status)).toBe(true);
    }
  });

  it("is false at the terminal status", () => {
    expect(canRecordFulfillmentWebhookFrom("closed")).toBe(false);
  });
});

describe("advanceableFulfillmentStatusesFrom", () => {
  it("excludes reservation_requested at created/failed (covered by the dedicated reserve action)", () => {
    expect(advanceableFulfillmentStatusesFrom("created")).toEqual(["cancelled"]);
    expect(advanceableFulfillmentStatusesFrom("failed")).toEqual(["cancelled"]);
  });

  it("is empty at packing_completed (fully covered by the dedicated ship action)", () => {
    expect(advanceableFulfillmentStatusesFrom("packing_completed")).toEqual([]);
  });

  it("returns the full transition table entry for a status with no dedicated action", () => {
    expect(advanceableFulfillmentStatusesFrom("confirmed")).toEqual(["picking_started", "cancelled"]);
    expect(advanceableFulfillmentStatusesFrom("in_transit")).toEqual([
      "out_for_delivery",
      "delivery_failed",
    ]);
  });

  it("returns an empty array for the terminal status", () => {
    expect(advanceableFulfillmentStatusesFrom("closed")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableFulfillmentStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("every status in the hand-kept table has an entry (no key silently missing)", () => {
    for (const status of Object.keys(FULFILLMENT_LIFECYCLE_TRANSITIONS)) {
      expect(() => advanceableFulfillmentStatusesFrom(status)).not.toThrow();
    }
  });
});
