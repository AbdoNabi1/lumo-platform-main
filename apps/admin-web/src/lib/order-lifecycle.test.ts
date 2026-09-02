import { describe, expect, it } from "vitest";
import { advanceableStatusesFrom, canRefundFrom, ORDER_LIFECYCLE_TRANSITIONS } from "./order-lifecycle";

describe("advanceableStatusesFrom", () => {
  it("excludes paid even though the transition table allows it from placed", () => {
    expect(ORDER_LIFECYCLE_TRANSITIONS["placed"]).toContain("paid");
    expect(advanceableStatusesFrom("placed")).toEqual(["cancelled"]);
  });

  it("excludes payment_received even though the transition table allows it from payment_requested", () => {
    expect(ORDER_LIFECYCLE_TRANSITIONS["payment_requested"]).toContain("payment_received");
    expect(advanceableStatusesFrom("payment_requested")).toEqual(["payment_failed"]);
  });

  it("returns every allowed target for a status with no payment-completion transitions", () => {
    expect(advanceableStatusesFrom("confirmed")).toEqual([
      "awaiting_payment",
      "held",
      "cancelled",
    ]);
  });

  it("returns an empty array for a terminal status", () => {
    expect(advanceableStatusesFrom("closed")).toEqual([]);
    expect(advanceableStatusesFrom("refunded")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableStatusesFrom("not-a-real-status")).toEqual([]);
  });
});

describe("canRefundFrom", () => {
  it("offers refund from the legacy paid status", () => {
    expect(canRefundFrom("paid")).toBe(true);
  });

  it("offers refund from returned and refund_requested in the full lifecycle", () => {
    expect(canRefundFrom("returned")).toBe(true);
    expect(canRefundFrom("refund_requested")).toBe(true);
  });

  it("does not offer refund from an unrelated status", () => {
    expect(canRefundFrom("placed")).toBe(false);
    expect(canRefundFrom("fulfilled")).toBe(false);
    expect(canRefundFrom("closed")).toBe(false);
  });
});
