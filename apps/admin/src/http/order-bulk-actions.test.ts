import { describe, expect, it, vi } from "vitest";
import type { Order } from "@platform/orders";
import type { PaymentIntentSummary } from "@platform/payments";
import { logger } from "@platform/utils";
import { BULK_RUNNERS } from "./order-bulk-actions";

const principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "t-1" } as never;

function order(id: string, events: readonly string[], paymentRef?: string): Order {
  return {
    id: { toString: () => id },
    history: events.map((type) => ({ type, occurredAt: new Date(0) })),
    paymentRef,
    items: [{ snapshot: { productId: `p-${id}` }, quantity: 2 }],
  } as unknown as Order;
}

const page = (orders: readonly Order[]) => ({
  status: 200,
  body: { items: orders, pageInfo: { hasNextPage: false, endCursor: null } },
});

function cod(overrides: Partial<PaymentIntentSummary> = {}): PaymentIntentSummary {
  return {
    id: "i-1",
    orderRef: "o-1",
    provider: "cod",
    status: "created",
    amountMinor: 45000,
    currency: "EGP",
    settlesAtPayTime: true,
    settledByOperatorConfirmation: true,
    ...overrides,
  };
}

function stubAdmin(orders: readonly Order[]) {
  return {
    orders: {
      listOrders: vi.fn().mockResolvedValue(page(orders)),
      fulfillmentsOfOrders: vi.fn().mockResolvedValue({ status: 200, body: [] }),
      requestPaymentCapture: vi.fn().mockResolvedValue({ status: 200, body: {} }),
      paymentIntentsOf: vi.fn().mockResolvedValue({ status: 200, body: [] }),
      archiveOrders: vi.fn(),
      unarchiveOrders: vi.fn(),
    },
    fulfillment: { create: vi.fn().mockResolvedValue({ status: 201, body: {} }) },
    payments: { confirmCodCollection: vi.fn().mockResolvedValue({ status: 200, body: {} }) },
  };
}

const run = (
  action: keyof typeof BULK_RUNNERS,
  admin: ReturnType<typeof stubAdmin>,
  orderIds: readonly string[],
) => BULK_RUNNERS[action]({ admin: admin as never, principal, tenantId: "t-1", orderIds });

describe("bulk fulfill (Fulfill items)", () => {
  it("opens a fulfillment for every item of each eligible order, and skips or fails the rest", async () => {
    const admin = stubAdmin([
      order("o-1", ["placed"]),
      order("o-2", ["placed"]),
      order("o-3", ["placed", "cancelled"]),
      order("o-5", ["placed"]),
      order("o-6", ["placed"]),
    ]);
    admin.orders.fulfillmentsOfOrders.mockResolvedValue({
      status: 200,
      body: [{ orderRef: "o-2", status: { value: "picking_started" } }],
    });
    admin.fulfillment.create.mockImplementation(
      async (_p: unknown, input: { orderRef: string }) => {
        if (input.orderRef === "o-5") return { status: 409, body: { message: "Out of stock" } };
        if (input.orderRef === "o-6") throw new Error("boom");
        return { status: 201, body: {} };
      },
    );

    const outcome = await run("fulfill", admin, ["o-1", "o-2", "o-3", "o-4", "o-5", "o-6"]);

    expect(outcome).toEqual({
      ok: true,
      results: [
        { orderId: "o-1", outcome: "ok" },
        { orderId: "o-2", outcome: "skipped", reason: "fulfillment_already_open" },
        { orderId: "o-3", outcome: "skipped", reason: "order_not_open" },
        { orderId: "o-4", outcome: "failed", reason: "not_found" },
        { orderId: "o-5", outcome: "failed", reason: "Out of stock" },
        { orderId: "o-6", outcome: "failed", reason: "unexpected_error" },
      ],
    });
    expect(admin.orders.listOrders).toHaveBeenCalledTimes(1);
    expect(admin.orders.listOrders).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      ids: ["o-1", "o-2", "o-3", "o-4", "o-5", "o-6"],
      first: 6,
    });
    expect(admin.fulfillment.create).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      orderRef: "o-1",
      items: [{ productRef: "p-o-1", quantity: 2 }],
    });
  });

  it("answers a failed list read as the response, touching nothing", async () => {
    const admin = stubAdmin([]);
    admin.orders.listOrders.mockResolvedValue({ status: 500, body: {} });
    expect(await run("fulfill", admin, ["o-1"])).toEqual({
      ok: false,
      response: { status: 500, body: {} },
    });
    expect(admin.fulfillment.create).not.toHaveBeenCalled();
  });
});

describe("a throw while running one order", () => {
  it("is logged with the action and order (no bodies), fails that order and still runs the others", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      const admin = stubAdmin([order("o-1", ["placed"]), order("o-2", ["placed"])]);
      admin.orders.requestPaymentCapture.mockImplementation(
        async (_p: unknown, input: { orderId: string }) => {
          if (input.orderId === "o-1") throw new Error("db down");
          return { status: 200, body: {} };
        },
      );

      const outcome = await run("capture_payments", admin, ["o-1", "o-2"]);

      expect(outcome.ok && outcome.results).toEqual([
        { orderId: "o-1", outcome: "failed", reason: "unexpected_error" },
        { orderId: "o-2", outcome: "ok" },
      ]);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(expect.any(String), {
        action: "capture_payments",
        orderId: "o-1",
        tenantId: "t-1",
        error: "db down",
      });
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe("bulk capture_payments (Capture payments)", () => {
  it("requests payment only for open, pending orders with no linked payment", async () => {
    const admin = stubAdmin([
      order("o-1", ["placed"]),
      order("o-2", ["placed", "paid"]),
      order("o-3", ["created", "confirmed", "awaiting_payment", "payment_requested"], "i-3"),
      order("o-4", ["placed", "cancelled"]),
    ]);

    const outcome = await run("capture_payments", admin, ["o-1", "o-2", "o-3", "o-4"]);

    expect(outcome.ok && outcome.results).toEqual([
      { orderId: "o-1", outcome: "ok" },
      { orderId: "o-2", outcome: "skipped", reason: "payment_not_pending" },
      { orderId: "o-3", outcome: "skipped", reason: "payment_already_requested" },
      { orderId: "o-4", outcome: "skipped", reason: "order_not_open" },
    ]);
    expect(admin.orders.requestPaymentCapture).toHaveBeenCalledTimes(1);
    expect(admin.orders.requestPaymentCapture).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      orderId: "o-1",
    });
  });
});

describe("bulk mark_cod_collected (Mark cash as received)", () => {
  const PENDING_COD = ["created", "confirmed", "awaiting_payment", "payment_requested"];

  it("settles each pending cash-on-delivery payment for the amount read from the intent", async () => {
    const admin = stubAdmin([
      order("o-1", PENDING_COD, "i-1"),
      order("o-2", PENDING_COD, "i-2"),
      order("o-3", PENDING_COD, "i-3"),
      order("o-4", PENDING_COD, "i-4"),
      order("o-5", ["placed", "paid"], "i-5"),
    ]);
    admin.orders.paymentIntentsOf.mockResolvedValue({
      status: 200,
      body: [
        cod(),
        cod({
          id: "i-2",
          orderRef: "o-2",
          provider: "stripe",
          settlesAtPayTime: false,
          settledByOperatorConfirmation: false,
        }),
        cod({ id: "i-3", orderRef: "o-3", status: "captured" }),
        cod({ id: "i-4", orderRef: "someone-else" }),
        cod({ id: "i-5", orderRef: "o-5" }),
      ],
    });

    const outcome = await run("mark_cod_collected", admin, ["o-1", "o-2", "o-3", "o-4", "o-5"]);

    expect(outcome.ok && outcome.results).toEqual([
      { orderId: "o-1", outcome: "ok" },
      { orderId: "o-2", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-3", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-4", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-5", outcome: "skipped", reason: "payment_not_pending" },
    ]);
    expect(admin.orders.paymentIntentsOf).toHaveBeenCalledTimes(1);
    expect(admin.payments.confirmCodCollection).toHaveBeenCalledTimes(1);
    expect(admin.payments.confirmCodCollection).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      paymentIntentId: "i-1",
      collectedAmountMinor: 45000,
      currency: "EGP",
    });
  });

  it("skips a cancelled order whose cash-on-delivery payment is still pending, confirming nothing", async () => {
    const admin = stubAdmin([order("o-1", [...PENDING_COD, "cancelled"], "i-1")]);
    admin.orders.paymentIntentsOf.mockResolvedValue({ status: 200, body: [cod()] });

    const outcome = await run("mark_cod_collected", admin, ["o-1"]);

    expect(outcome.ok && outcome.results).toEqual([
      { orderId: "o-1", outcome: "skipped", reason: "payment_not_pending" },
    ]);
    expect(admin.payments.confirmCodCollection).not.toHaveBeenCalled();
  });

  it("skips a pending order whose intent is already settled, or cancelled", async () => {
    const admin = stubAdmin([
      order("o-1", PENDING_COD, "i-1"),
      order("o-2", PENDING_COD, "i-2"),
      order("o-3", PENDING_COD, "i-3"),
    ]);
    admin.orders.paymentIntentsOf.mockResolvedValue({
      status: 200,
      body: [
        cod({ status: "refunded" }),
        cod({ id: "i-2", orderRef: "o-2", status: "cancelled" }),
        cod({ id: "i-3", orderRef: "o-3", status: "partially_refunded" }),
      ],
    });

    const outcome = await run("mark_cod_collected", admin, ["o-1", "o-2", "o-3"]);

    expect(outcome.ok && outcome.results).toEqual([
      { orderId: "o-1", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-2", outcome: "skipped", reason: "not_cash_on_delivery" },
      { orderId: "o-3", outcome: "skipped", reason: "not_cash_on_delivery" },
    ]);
    expect(admin.payments.confirmCodCollection).not.toHaveBeenCalled();
  });

  it("settles nothing when the payments read fails", async () => {
    const admin = stubAdmin([order("o-1", PENDING_COD, "i-1")]);
    admin.orders.paymentIntentsOf.mockResolvedValue({ status: 503, body: {} });
    expect((await run("mark_cod_collected", admin, ["o-1"])).ok).toBe(false);
    expect(admin.payments.confirmCodCollection).not.toHaveBeenCalled();
  });
});

describe("bulk archive / unarchive", () => {
  it("maps the use case's outcomes and passes the actor", async () => {
    const admin = stubAdmin([]);
    admin.orders.archiveOrders.mockResolvedValue({
      status: 200,
      body: {
        results: [
          { orderId: "o-1", outcome: "changed", archivedAt: new Date(0) },
          { orderId: "o-2", outcome: "unchanged", archivedAt: new Date(0) },
          { orderId: "o-3", outcome: "not_found", archivedAt: null },
        ],
      },
    });
    admin.orders.unarchiveOrders.mockResolvedValue({
      status: 200,
      body: { results: [{ orderId: "o-1", outcome: "unchanged", archivedAt: null }] },
    });

    const archived = await run("archive", admin, ["o-1", "o-2", "o-3"]);
    const unarchived = await run("unarchive", admin, ["o-1"]);

    expect(archived.ok && archived.results).toEqual([
      { orderId: "o-1", outcome: "ok" },
      { orderId: "o-2", outcome: "skipped", reason: "already_archived" },
      { orderId: "o-3", outcome: "failed", reason: "not_found" },
    ]);
    expect(unarchived.ok && unarchived.results).toEqual([
      { orderId: "o-1", outcome: "skipped", reason: "not_archived" },
    ]);
    expect(admin.orders.archiveOrders).toHaveBeenCalledWith(principal, {
      tenantId: "t-1",
      orderIds: ["o-1", "o-2", "o-3"],
      actorRef: "staff-1",
    });
  });
});
