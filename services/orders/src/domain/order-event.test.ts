import { describe, expect, it } from "vitest";
import { canTransition, type OrderEventType } from "./order-event";

/**
 * The whole transition table, spelled out. Plan 3B follow-up (G-126) added exactly ONE row entry —
 * `payment_requested -> cancelled` — so this pins every other pair to what it was before: an unpaid
 * cash-on-delivery order can be cancelled, and nothing else about the lifecycle moved.
 */
const EXPECTED: Readonly<Record<OrderEventType, readonly OrderEventType[]>> = {
  placed: ["paid", "cancelled"],
  paid: ["refunded"],
  refunded: [],
  created: ["confirmed", "cancelled"],
  confirmed: ["awaiting_payment", "held", "cancelled"],
  held: ["resumed", "cancelled"],
  resumed: ["awaiting_payment"],
  awaiting_payment: ["payment_requested", "cancelled"],
  payment_requested: ["payment_received", "payment_failed", "cancelled"],
  payment_failed: ["payment_requested", "cancelled"],
  payment_received: ["ready_for_fulfillment"],
  ready_for_fulfillment: ["fulfillment_requested"],
  fulfillment_requested: ["fulfilled", "partially_fulfilled"],
  partially_fulfilled: ["fulfilled"],
  fulfilled: ["delivered"],
  delivered: ["return_requested", "closed"],
  return_requested: ["returned"],
  returned: ["refund_requested", "closed"],
  refund_requested: ["closed"],
  cancelled: ["closed"],
  closed: [],
};

const ALL = Object.keys(EXPECTED) as OrderEventType[];

describe("order lifecycle transition table", () => {
  it("lets an order whose payment was requested but not received be cancelled (G-126)", () => {
    expect(canTransition("payment_requested", "cancelled")).toBe(true);
  });

  it("never lets a paid order be cancelled, whatever stage it reached after payment", () => {
    for (const from of [
      "paid",
      "payment_received",
      "ready_for_fulfillment",
      "fulfillment_requested",
      "partially_fulfilled",
      "fulfilled",
      "delivered",
    ] as const) {
      expect(canTransition(from, "cancelled")).toBe(false);
    }
  });

  it.each(ALL)("allows exactly the expected targets from %s and no other", (from) => {
    const allowed = ALL.filter((to) => canTransition(from, to));
    expect(allowed.sort()).toEqual([...EXPECTED[from]].sort());
  });
});
