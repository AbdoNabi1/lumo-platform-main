import { describe, expect, it } from "vitest";
import type { OrderEventType } from "./order-event";
import { RefundPolicy } from "./refund-policy";

const ALL: readonly OrderEventType[] = [
  "placed",
  "paid",
  "refunded",
  "created",
  "confirmed",
  "cancelled",
  "held",
  "resumed",
  "awaiting_payment",
  "payment_requested",
  "payment_received",
  "payment_failed",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "fulfilled",
  "partially_fulfilled",
  "delivered",
  "return_requested",
  "returned",
  "refund_requested",
  "closed",
];

/** Every state an order reaches AFTER its payment was received (G-127), plus the legacy `paid`. */
const REFUNDABLE: readonly OrderEventType[] = [
  "paid",
  "payment_received",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "partially_fulfilled",
  "fulfilled",
  "delivered",
  "returned",
];

describe("RefundPolicy", () => {
  it.each(REFUNDABLE)("allows a refund from %s, where the payment has been received", (status) => {
    expect(new RefundPolicy().canRefund(status)).toBe(true);
  });

  it("never allows a refund before the payment was received", () => {
    for (const status of [
      "placed",
      "created",
      "confirmed",
      "held",
      "resumed",
      "awaiting_payment",
      "payment_requested",
      "payment_failed",
      "cancelled",
    ] as const) {
      expect(new RefundPolicy().canRefund(status)).toBe(false);
    }
  });

  it("refuses everything else, exactly: an order is refunded once, and a closed one is final", () => {
    const refused = ALL.filter((status) => !new RefundPolicy().canRefund(status));
    expect(refused.sort()).toEqual(ALL.filter((s) => !REFUNDABLE.includes(s)).sort());
    expect(new RefundPolicy().canRefund("refunded")).toBe(false);
    expect(new RefundPolicy().canRefund("refund_requested")).toBe(false);
    expect(new RefundPolicy().canRefund("return_requested")).toBe(false);
    expect(new RefundPolicy().canRefund("closed")).toBe(false);
  });
});
