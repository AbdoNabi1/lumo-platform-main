import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const payments = vi.hoisted(() => ({
  fetchPaymentIntent: vi.fn(),
  confirmCodCollection: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/payments", () => ({
  fetchPaymentIntent: payments.fetchPaymentIntent,
  confirmCodCollection: payments.confirmCodCollection,
}));
vi.mock("@/lib/api/orders", () => ({
  advanceOrder: vi.fn(),
  createOrderFromCheckout: vi.fn(),
  markOrderPaid: vi.fn(),
  placeOrder: vi.fn(),
  refundOrder: vi.fn(),
  requestFulfillment: vi.fn(),
  requestPaymentCapture: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { confirmCodCollectionAction } = await import("./actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    orderRef: "order-1",
    provider: "cod",
    status: "created",
    currency: "EGP",
    amountMinor: 45000,
    authorizedAmountMinor: null,
    capturedAmountMinor: 0,
    refundedAmountMinor: 0,
    pspReference: null,
    capturedAt: null,
    refundedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  payments.fetchPaymentIntent
    .mockReset()
    .mockResolvedValue({ outcome: "ok", paymentIntent: intent() });
  payments.confirmCodCollection.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidatePath.mockReset();
});

describe("confirmCodCollectionAction (Plan 3A)", () => {
  it("collects the amount and currency read from the payment intent on the server, never from the form", async () => {
    const state = await confirmCodCollectionAction(
      idle,
      form({
        orderId: "order-1",
        paymentIntentId: "intent-1",
        // A tampered browser tries to settle for less, or in another currency.
        collectedAmountMinor: "1",
        currency: "USD",
      }),
    );

    expect(state).toEqual({ status: "success" });
    expect(payments.confirmCodCollection).toHaveBeenCalledTimes(1);
    expect(payments.confirmCodCollection).toHaveBeenCalledWith(
      "intent-1",
      45000,
      "EGP",
      expect.any(String),
    );
  });

  it("refreshes the order page and the orders list on success", async () => {
    await confirmCodCollectionAction(
      idle,
      form({ orderId: "order-1", paymentIntentId: "intent-1" }),
    );

    expect(revalidatePath).toHaveBeenCalledWith("/orders/order-1");
    expect(revalidatePath).toHaveBeenCalledWith("/orders");
  });

  it("refuses without any API call when an id is missing", async () => {
    const state = await confirmCodCollectionAction(idle, form({ orderId: "order-1" }));

    expect(state.status).toBe("error");
    expect(payments.fetchPaymentIntent).not.toHaveBeenCalled();
    expect(payments.confirmCodCollection).not.toHaveBeenCalled();
  });

  it("refuses a payment that is not cash on delivery", async () => {
    payments.fetchPaymentIntent.mockResolvedValue({
      outcome: "ok",
      paymentIntent: intent({ provider: "stripe" }),
    });

    const state = await confirmCodCollectionAction(
      idle,
      form({ orderId: "order-1", paymentIntentId: "intent-1" }),
    );

    expect(state.status).toBe("error");
    expect(payments.confirmCodCollection).not.toHaveBeenCalled();
  });

  it("refuses a payment intent that belongs to a different order", async () => {
    payments.fetchPaymentIntent.mockResolvedValue({
      outcome: "ok",
      paymentIntent: intent({ orderRef: "order-2" }),
    });

    const state = await confirmCodCollectionAction(
      idle,
      form({ orderId: "order-1", paymentIntentId: "intent-1" }),
    );

    expect(state.status).toBe("error");
    expect(payments.confirmCodCollection).not.toHaveBeenCalled();
  });

  it("maps a failed read of the payment intent to a form error and never collects", async () => {
    payments.fetchPaymentIntent.mockResolvedValue({ outcome: "not_found" });

    const state = await confirmCodCollectionAction(
      idle,
      form({ orderId: "order-1", paymentIntentId: "intent-1" }),
    );

    expect(state.status).toBe("error");
    expect(payments.confirmCodCollection).not.toHaveBeenCalled();
  });

  it("maps a 409 from the API to a form error and does not refresh", async () => {
    payments.confirmCodCollection.mockResolvedValue({
      outcome: "conflict",
      message: "The collected amount must equal the amount due",
    });

    const state = await confirmCodCollectionAction(
      idle,
      form({ orderId: "order-1", paymentIntentId: "intent-1" }),
    );

    expect(state).toMatchObject({
      status: "error",
      message: "The collected amount must equal the amount due",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
