import { describe, expect, it } from "vitest";
import { COUPON_LIFECYCLE_TRANSITIONS, couponAdvanceableStatusesFrom } from "./coupon-lifecycle";

describe("couponAdvanceableStatusesFrom", () => {
  it("returns every allowed target from active", () => {
    expect(couponAdvanceableStatusesFrom("active")).toEqual(["disabled", "expired", "depleted"]);
  });

  it("returns every allowed target from disabled", () => {
    expect(couponAdvanceableStatusesFrom("disabled")).toEqual(["active", "expired"]);
  });

  it("returns an empty array for the terminal expired status", () => {
    expect(couponAdvanceableStatusesFrom("expired")).toEqual([]);
  });

  it("returns an empty array for the terminal depleted status", () => {
    expect(couponAdvanceableStatusesFrom("depleted")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(couponAdvanceableStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("matches the table's own keys", () => {
    expect(Object.keys(COUPON_LIFECYCLE_TRANSITIONS)).toEqual([
      "active",
      "disabled",
      "expired",
      "depleted",
    ]);
  });
});
