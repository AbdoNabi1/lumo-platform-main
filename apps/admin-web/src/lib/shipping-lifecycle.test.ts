import { describe, expect, it } from "vitest";
import {
  advanceableShipmentStatusesFrom,
  canCreateLabelFrom,
  canRecordShipmentWebhookFrom,
  canRetryFrom,
  canUpdateTrackingFrom,
  canVoidLabelFrom,
  SHIPMENT_LIFECYCLE_TRANSITIONS,
} from "./shipping-lifecycle";

describe("canCreateLabelFrom", () => {
  it("is true only at created", () => {
    expect(canCreateLabelFrom("created")).toBe(true);
  });
  it("is false everywhere else", () => {
    expect(canCreateLabelFrom("label_created")).toBe(false);
  });
});

describe("canVoidLabelFrom", () => {
  it("is true only at label_created", () => {
    expect(canVoidLabelFrom("label_created")).toBe(true);
  });
  it("is false everywhere else", () => {
    expect(canVoidLabelFrom("created")).toBe(false);
  });
});

describe("canUpdateTrackingFrom", () => {
  it("is true at the three in-motion statuses", () => {
    expect(canUpdateTrackingFrom("carrier_accepted")).toBe(true);
    expect(canUpdateTrackingFrom("in_transit")).toBe(true);
    expect(canUpdateTrackingFrom("out_for_delivery")).toBe(true);
  });
  it("is false elsewhere", () => {
    expect(canUpdateTrackingFrom("created")).toBe(false);
    expect(canUpdateTrackingFrom("delivered")).toBe(false);
  });
});

describe("canRetryFrom", () => {
  it("is true at exactly the brief's 3 named recoverable states", () => {
    expect(canRetryFrom("rejected")).toBe(true);
    expect(canRetryFrom("delivery_failed")).toBe(true);
    expect(canRetryFrom("exception")).toBe(true);
  });
  it("is false everywhere else", () => {
    expect(canRetryFrom("created")).toBe(false);
    expect(canRetryFrom("in_transit")).toBe(false);
    expect(canRetryFrom("closed")).toBe(false);
  });
});

describe("canRecordShipmentWebhookFrom", () => {
  it("is true for every non-terminal status", () => {
    for (const status of Object.keys(SHIPMENT_LIFECYCLE_TRANSITIONS)) {
      if (status === "closed") continue;
      expect(canRecordShipmentWebhookFrom(status)).toBe(true);
    }
  });
  it("is false at the terminal status", () => {
    expect(canRecordShipmentWebhookFrom("closed")).toBe(false);
  });
});

describe("advanceableShipmentStatusesFrom", () => {
  it("excludes label_created at created (covered by the dedicated label action)", () => {
    expect(advanceableShipmentStatusesFrom("created")).toEqual(["voided", "cancelled"]);
  });
  it("excludes voided at label_created (covered by the dedicated label-void action)", () => {
    expect(advanceableShipmentStatusesFrom("label_created")).toEqual([
      "carrier_accepted",
      "rejected",
      "cancelled",
    ]);
  });
  it("excludes created at rejected/exception (covered by retry)", () => {
    expect(advanceableShipmentStatusesFrom("rejected")).toEqual(["cancelled"]);
    expect(advanceableShipmentStatusesFrom("exception")).toEqual(["closed"]);
  });
  it("excludes in_transit at delivery_failed (covered by retry)", () => {
    expect(advanceableShipmentStatusesFrom("delivery_failed")).toEqual(["exception", "closed"]);
  });
  it("returns the full transition table entry for a status with no dedicated coverage", () => {
    expect(advanceableShipmentStatusesFrom("carrier_accepted")).toEqual(["in_transit", "cancelled"]);
    expect(advanceableShipmentStatusesFrom("voided")).toEqual(["created", "closed"]);
  });
  it("returns an empty array for the terminal status", () => {
    expect(advanceableShipmentStatusesFrom("closed")).toEqual([]);
  });
  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableShipmentStatusesFrom("not-a-real-status")).toEqual([]);
  });
});
