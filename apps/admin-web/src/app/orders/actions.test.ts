import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const payments = vi.hoisted(() => ({
  fetchPaymentIntent: vi.fn(),
  confirmCodCollection: vi.fn(),
}));
const orders = vi.hoisted(() => ({
  bulkOrders: vi.fn(),
  archiveOrder: vi.fn(),
  unarchiveOrder: vi.fn(),
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
  refundOrder: vi.fn(),
  requestFulfillment: vi.fn(),
  requestPaymentCapture: vi.fn(),
  bulkOrders: orders.bulkOrders,
  archiveOrder: orders.archiveOrder,
  unarchiveOrder: orders.unarchiveOrder,
  BULK_ORDER_ACTIONS: [
    "archive",
    "unarchive",
    "fulfill",
    "capture_payments",
    "mark_cod_collected",
    "add_tags",
    "remove_tags",
  ],
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { archiveOrderAction, confirmCodCollectionAction, runBulkOrderAction, unarchiveOrderAction } =
  await import("./actions");

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

  it("settles a pending staff-recorded (manual) payment of this order — a draft's Mark as paid that stopped half-way", async () => {
    payments.fetchPaymentIntent.mockResolvedValue({
      outcome: "ok",
      paymentIntent: intent({ provider: "manual" }),
    });

    const state = await confirmCodCollectionAction(
      idle,
      form({ orderId: "order-1", paymentIntentId: "intent-1" }),
    );

    expect(state).toEqual({ status: "success" });
    expect(payments.confirmCodCollection).toHaveBeenCalledWith(
      "intent-1",
      45000,
      "EGP",
      expect.any(String),
    );
  });

  it("still refuses a manual payment of another order", async () => {
    payments.fetchPaymentIntent.mockResolvedValue({
      outcome: "ok",
      paymentIntent: intent({ provider: "manual", orderRef: "order-2" }),
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

describe("runBulkOrderAction (order operations Part 1)", () => {
  beforeEach(() => {
    orders.bulkOrders.mockReset().mockResolvedValue({
      outcome: "ok",
      data: { results: [{ orderId: "o-1", outcome: "ok" }] },
    });
  });

  it("sends the deduped ids with one fresh key, returns the results and refreshes the list", async () => {
    const state = await runBulkOrderAction("archive", ["o-1", "o-1"]);

    expect(state).toEqual({ status: "done", results: [{ orderId: "o-1", outcome: "ok" }] });
    expect(orders.bulkOrders).toHaveBeenCalledWith("archive", ["o-1"], expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/orders");
  });

  it("refuses an unknown action, no ids or more than 50 without calling the API", async () => {
    for (const [action, ids] of [
      ["cancel", ["o-1"]],
      ["archive", []],
      ["archive", Array.from({ length: 51 }, (_, i) => `o-${i}`)],
    ] as const) {
      expect((await runBulkOrderAction(action, ids)).status).toBe("error");
    }
    expect(orders.bulkOrders).not.toHaveBeenCalled();
  });

  it("turns a 403 into the form's forbidden message and does not refresh", async () => {
    orders.bulkOrders.mockResolvedValue({ outcome: "forbidden" });
    const state = await runBulkOrderAction("mark_cod_collected", ["o-1"]);
    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("archiveOrderAction / unarchiveOrderAction", () => {
  beforeEach(() => {
    orders.archiveOrder.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
    orders.unarchiveOrder.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  });

  it("archives the order named in the form and refreshes the list and the page", async () => {
    expect(await archiveOrderAction(idle, form({ orderId: "order-1" }))).toEqual({
      status: "success",
    });
    expect(orders.archiveOrder).toHaveBeenCalledWith("order-1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/orders");
    expect(revalidatePath).toHaveBeenCalledWith("/orders/order-1");
  });

  it("unarchives, and refuses a form without an order id", async () => {
    expect(await unarchiveOrderAction(idle, form({ orderId: "order-1" }))).toEqual({
      status: "success",
    });
    expect((await archiveOrderAction(idle, form({}))).status).toBe("error");
  });
});

describe("runBulkOrderAction with tags (order operations Part 2)", () => {
  it("passes the tags for add_tags / remove_tags and nothing extra for the others", async () => {
    orders.bulkOrders.mockResolvedValue({ outcome: "ok", data: { results: [] } });
    await runBulkOrderAction("add_tags", ["o-1"], ["VIP", " "]);
    expect(orders.bulkOrders).toHaveBeenLastCalledWith("add_tags", ["o-1"], expect.any(String), [
      "VIP",
    ]);
    await runBulkOrderAction("archive", ["o-1"]);
    expect(orders.bulkOrders).toHaveBeenLastCalledWith("archive", ["o-1"], expect.any(String));
  });

  it("refuses add_tags without tags, or with more than 20", async () => {
    orders.bulkOrders.mockClear();
    expect((await runBulkOrderAction("add_tags", ["o-1"])).status).toBe("error");
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect((await runBulkOrderAction("remove_tags", ["o-1"], many)).status).toBe("error");
    expect(orders.bulkOrders).not.toHaveBeenCalled();
  });
});
