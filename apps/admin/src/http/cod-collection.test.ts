import { describe, expect, it } from "vitest";
import type { Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import { codCollectionState } from "./cod-collection";

const AT = new Date(0);
const PENDING = ["created", "payment_requested"];

function order(events: readonly string[] = PENDING): Order {
  return {
    id: { toString: () => "o-1" },
    history: events.map((type) => ({ type, occurredAt: AT })),
  } as unknown as Order;
}

function cod(overrides: Partial<PaymentIntentSummary> = {}): PaymentIntentSummary {
  return {
    id: "i-1",
    orderRef: "o-1",
    provider: "cod",
    status: "created",
    amountMinor: 50000,
    currency: "EGP",
    settlesAtPayTime: true,
    settledByOperatorConfirmation: true,
    collectedOnDelivery: true,
    ...overrides,
  };
}

const NONE = { printAmount: false, canMarkCollected: false };

describe("codCollectionState (one COD eligibility predicate)", () => {
  it("prints the amount and allows marking collected for a pending cash-on-delivery payment", () => {
    expect(codCollectionState(order(), cod())).toEqual({
      printAmount: true,
      canMarkCollected: true,
    });
  });

  it("is nothing without an intent, for a card intent, or for another order's intent", () => {
    expect(codCollectionState(order(), undefined)).toEqual(NONE);
    expect(
      codCollectionState(
        order(),
        cod({ settledByOperatorConfirmation: false, collectedOnDelivery: false }),
      ),
    ).toEqual(NONE);
    expect(codCollectionState(order(), cod({ orderRef: "o-2" }))).toEqual(NONE);
  });

  it("is nothing once the order is no longer payment-pending", () => {
    expect(codCollectionState(order([...PENDING, "payment_received"]), cod())).toEqual(NONE);
    expect(codCollectionState(order([...PENDING, "cancelled"]), cod())).toEqual(NONE);
  });

  it.each(["captured", "refunded", "partially_refunded", "closed"])(
    "is nothing when the intent is already %s (cash received, order not yet updated)",
    (status) => {
      expect(codCollectionState(order(), cod({ status }))).toEqual(NONE);
    },
  );

  it.each(["cancelled", "expired", "failed"])(
    "still prints the amount but cannot be marked collected when the intent is %s",
    (status) => {
      expect(codCollectionState(order(), cod({ status }))).toEqual({
        printAmount: true,
        canMarkCollected: false,
      });
    },
  );
});

describe("a draft completed as paid (order operations Part 4, Ruling 9)", () => {
  const manual = (status: string) =>
    cod({
      provider: "manual",
      status,
      collectedOnDelivery: false,
      settledByOperatorConfirmation: true,
    });

  it("a manual intent on a still-pending order is not cash to collect and not markable", () => {
    expect(codCollectionState(order(), manual("created"))).toEqual({
      printAmount: false,
      canMarkCollected: false,
    });
  });

  it("is NEVER cash to collect — pending, settled or dead", () => {
    for (const status of ["created", "capture_requested", "captured", "cancelled"]) {
      expect(codCollectionState(order(), manual(status)), status).toEqual(NONE);
    }
  });

  it("a cash-on-delivery intent is still collected, keyed on the capability, not the name", () => {
    expect(
      codCollectionState(order(), cod({ provider: "courier-cash", collectedOnDelivery: true })),
    ).toEqual({
      printAmount: true,
      canMarkCollected: true,
    });
  });
});
