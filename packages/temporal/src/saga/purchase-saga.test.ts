import { describe, expect, it } from "vitest";
import {
  runPurchaseSaga,
  type PurchaseSagaActivities,
  type PurchaseSagaInput,
  type QuoteResult,
} from "./purchase-saga";

const input: PurchaseSagaInput = {
  tenantId: "t-1",
  checkoutSessionId: "cs-1",
  cartRef: "cart-1",
  customerRef: "cust-1",
};
const quote: QuoteResult = {
  currency: "USD",
  totalAmountMinor: 3998,
  lines: [{ productRef: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
};

/** Recording fake — the log IS the assertion: order and completeness of effects. */
function fakes(overrides: Partial<PurchaseSagaActivities> = {}) {
  const log: string[] = [];
  const activities: PurchaseSagaActivities = {
    priceQuote: async () => (log.push("quote"), quote),
    reserveStock: async () => (log.push("reserve"), { reservationRef: "res-1" }),
    createPaymentIntent: async () => (log.push("intent"), { paymentIntentRef: "pi-1" }),
    placeOrder: async () => (log.push("placeOrder"), { orderRef: "o-1" }),
    commitReservation: async () => void log.push("commit"),
    releaseReservation: async () => void log.push("release"),
    cancelPaymentIntent: async () => void log.push("cancelIntent"),
    refundPayment: async () => void log.push("refund"),
    completeCheckout: async () => void log.push("complete"),
    failCheckout: async (_i, reason) => void log.push(`fail:${reason}`),
    sendConfirmation: async () => void log.push("confirm"),
    alertOperator: async () => void log.push("alert"),
    ...overrides,
  };
  return { log, activities };
}

describe("purchase saga core (ADR-0012 — deterministic, replay-safe)", () => {
  it("happy path executes the exact step sequence and completes", async () => {
    const { log, activities } = fakes();
    const outcome = await runPurchaseSaga(activities, input, async () => "captured");
    expect(outcome).toEqual({ status: "completed", orderRef: "o-1" });
    expect(log).toEqual([
      "quote",
      "reserve",
      "intent",
      "placeOrder",
      "commit",
      "complete",
      "confirm",
    ]);
  });

  it("inventory unavailable: fails checkout with NOTHING to unwind", async () => {
    const { log, activities } = fakes({
      reserveStock: async () => {
        throw new Error("insufficient");
      },
    });
    const outcome = await runPurchaseSaga(activities, input, async () => "captured");
    expect(outcome.status).toBe("failed");
    expect(log).toEqual(["quote", "fail:inventory_unavailable"]);
  });

  it("PSP unavailable at intent creation: release → fail (reverse-order compensation)", async () => {
    const { log, activities } = fakes({
      createPaymentIntent: async () => {
        throw new Error("psp down");
      },
    });
    await runPurchaseSaga(activities, input, async () => "captured");
    expect(log).toEqual(["quote", "reserve", "release", "fail:payment_provider_unavailable"]);
  });

  it("payment failed signal: cancel intent → release → fail", async () => {
    const { log, activities } = fakes();
    const outcome = await runPurchaseSaga(activities, input, async () => "failed");
    expect(outcome).toEqual({ status: "failed", reason: "payment_failed" });
    expect(log).toEqual([
      "quote",
      "reserve",
      "intent",
      "cancelIntent",
      "release",
      "fail:payment_failed",
    ]);
  });

  it("capture timeout compensates identically with the timeout reason", async () => {
    const { log, activities } = fakes();
    const outcome = await runPurchaseSaga(activities, input, async () => "timeout");
    expect(outcome).toEqual({ status: "failed", reason: "payment_timeout" });
    expect(log.at(-1)).toBe("fail:payment_timeout");
  });

  it("order placement fails AFTER capture: refund → release → fail → operator alert (money moved)", async () => {
    const { log, activities } = fakes({
      placeOrder: async () => {
        throw new Error("orders down");
      },
    });
    const outcome = await runPurchaseSaga(activities, input, async () => "captured");
    expect(outcome).toEqual({ status: "failed", reason: "order_placement_failed" });
    expect(log).toEqual([
      "quote",
      "reserve",
      "intent",
      "refund",
      "release",
      "fail:order_placement_failed",
      "alert",
    ]);
  });

  it("REPLAY determinism: identical inputs + signal produce byte-identical decision logs", async () => {
    const first = fakes();
    const second = fakes();
    await runPurchaseSaga(first.activities, input, async () => "captured");
    await runPurchaseSaga(second.activities, input, async () => "captured");
    expect(first.log).toEqual(second.log); // no clock, no ids, no hidden state — pure function of inputs
  });
});
