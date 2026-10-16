import { describe, expect, it } from "vitest";
import type { OrderEventType } from "./order-event";
import { derivePaymentStatus, isOpenOrder } from "./order-statuses";

function history(...types: OrderEventType[]) {
  return types.map((type) => ({ type }));
}

describe("derivePaymentStatus", () => {
  it.each<[string, OrderEventType[]]>([
    ["a new checkout order", ["created"]],
    ["confirmed", ["created", "confirmed"]],
    ["awaiting payment", ["created", "confirmed", "awaiting_payment"]],
    [
      "payment requested (cash on delivery, not yet collected)",
      ["created", "confirmed", "awaiting_payment", "payment_requested"],
    ],
    [
      "a failed payment attempt",
      ["created", "confirmed", "awaiting_payment", "payment_requested", "payment_failed"],
    ],
    ["a held order", ["created", "confirmed", "held"]],
    ["a legacy placed order", ["placed"]],
  ])("is pending for %s", (_name, types) => {
    expect(derivePaymentStatus(history(...types))).toBe("pending");
  });

  it.each<[string, OrderEventType[]]>([
    ["a legacy paid order", ["placed", "paid"]],
    [
      "payment received",
      ["created", "confirmed", "awaiting_payment", "payment_requested", "payment_received"],
    ],
    [
      "ready for fulfillment",
      [
        "created",
        "confirmed",
        "awaiting_payment",
        "payment_requested",
        "payment_received",
        "ready_for_fulfillment",
      ],
    ],
    [
      "fulfilled",
      [
        "created",
        "confirmed",
        "awaiting_payment",
        "payment_requested",
        "payment_received",
        "ready_for_fulfillment",
        "fulfillment_requested",
        "fulfilled",
      ],
    ],
    [
      "delivered and closed",
      [
        "created",
        "confirmed",
        "awaiting_payment",
        "payment_requested",
        "payment_received",
        "ready_for_fulfillment",
        "fulfillment_requested",
        "fulfilled",
        "delivered",
        "closed",
      ],
    ],
  ])("is paid for %s", (_name, types) => {
    expect(derivePaymentStatus(history(...types))).toBe("paid");
  });

  it.each<[string, OrderEventType[]]>([
    ["a legacy refunded order", ["placed", "paid", "refunded"]],
    [
      "a refund requested after a return",
      [
        "created",
        "confirmed",
        "awaiting_payment",
        "payment_requested",
        "payment_received",
        "ready_for_fulfillment",
        "fulfillment_requested",
        "fulfilled",
        "delivered",
        "return_requested",
        "returned",
        "refund_requested",
      ],
    ],
    [
      "a refunded order that was then closed",
      [
        "created",
        "confirmed",
        "awaiting_payment",
        "payment_requested",
        "payment_received",
        "ready_for_fulfillment",
        "fulfillment_requested",
        "fulfilled",
        "delivered",
        "return_requested",
        "returned",
        "refund_requested",
        "closed",
      ],
    ],
  ])("is refunded for %s", (_name, types) => {
    expect(derivePaymentStatus(history(...types))).toBe("refunded");
  });

  it.each<[string, OrderEventType[]]>([
    ["an order cancelled before any payment", ["created", "cancelled"]],
    [
      "a cancelled order that was awaiting payment",
      ["created", "confirmed", "awaiting_payment", "cancelled"],
    ],
    ["a cancelled, closed order", ["created", "cancelled", "closed"]],
    ["a legacy placed order that was cancelled", ["placed", "cancelled"]],
    [
      "a cash-on-delivery order cancelled while its collection was still pending",
      ["created", "confirmed", "awaiting_payment", "payment_requested", "cancelled"],
    ],
  ])("is voided for %s", (_name, types) => {
    expect(derivePaymentStatus(history(...types))).toBe("voided");
  });

  it("a payment that failed and was retried is still pending until it is received", () => {
    expect(
      derivePaymentStatus(
        history(
          "created",
          "confirmed",
          "awaiting_payment",
          "payment_requested",
          "payment_failed",
          "payment_requested",
        ),
      ),
    ).toBe("pending");
  });

  it("is pending for an empty history (nothing has happened yet)", () => {
    expect(derivePaymentStatus([])).toBe("pending");
  });
});

describe("isOpenOrder (Plan 3D: an order that can still need fulfilling)", () => {
  it("is open while nothing has cancelled or closed it", () => {
    expect(isOpenOrder(history("created"))).toBe(true);
    expect(isOpenOrder(history("placed", "paid"))).toBe(true);
    expect(isOpenOrder(history("created", "confirmed", "payment_received", "delivered"))).toBe(
      true,
    );
  });

  it("is not open once it was cancelled, even if it was closed afterwards or never closed", () => {
    expect(isOpenOrder(history("created", "cancelled"))).toBe(false);
    expect(isOpenOrder(history("created", "cancelled", "closed"))).toBe(false);
  });

  it("is not open once it is closed", () => {
    expect(isOpenOrder(history("created", "delivered", "closed"))).toBe(false);
  });
});
