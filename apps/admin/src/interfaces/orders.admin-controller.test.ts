import type {
  AccessControl,
  AuditEvent,
  AuditTrail,
  Permission,
  Principal,
} from "@platform/contracts";
import type { FulfillmentController } from "@platform/fulfillment";
import type { OrderController } from "@platform/orders";
import type { PaymentController } from "@platform/payments";
import { describe, expect, it, vi } from "vitest";
import { AdminGuard } from "./admin-guard";
import { OrdersAdminController } from "./orders.admin-controller";

const staff: Principal = { id: "staff-1", kind: "staff", roles: [], tenantId: "t-1" };

function guardAnswering(allowed: boolean): { guard: AdminGuard; asked: Permission[] } {
  const asked: Permission[] = [];
  const accessControl: AccessControl = {
    authorize: async (_principal, permission) => {
      asked.push(permission);
      return allowed;
    },
  };
  const auditTrail: AuditTrail = { record: async (_entry: AuditEvent) => undefined };
  return {
    guard: new AdminGuard({ accessControl, auditTrail, clock: { now: () => new Date(0) } }),
    asked,
  };
}

/** Fails loudly the moment a method delegates to a controller without being authorized first. */
function unreachable<T extends object>(name: string): T {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw new Error(`reached ${name}.${String(property)} without authorizing`);
      },
    },
  ) as T;
}

function controller(
  guard: AdminGuard,
  overrides: Partial<ConstructorParameters<typeof OrdersAdminController>[0]> = {},
) {
  return new OrdersAdminController({
    orders: unreachable<OrderController>("OrderController"),
    fulfillment: unreachable<Pick<FulfillmentController, "getByOrders">>("FulfillmentController"),
    payments:
      unreachable<Pick<PaymentController, "getPaymentIntent" | "refundLifecycle">>(
        "PaymentController",
      ),
    guard,
    ...overrides,
  });
}

describe("OrdersAdminController", () => {
  // Every action authorizes before it delegates (ADR-0007). Walks the PROTOTYPE rather than a hand
  // written list, so a method added later is covered the day it lands.
  it("every method authorizes first: a denied caller never reaches Orders, Fulfillment or Payments", async () => {
    const { guard, asked } = guardAnswering(false);
    const target = controller(guard);
    const methods = Object.getOwnPropertyNames(OrdersAdminController.prototype).filter(
      (name) => name !== "constructor",
    );
    expect(methods).toEqual(
      expect.arrayContaining([
        "getOrder",
        "listOrders",
        "fulfillmentsOfOrders",
        "paymentIntentOf",
        "salesReport",
      ]),
    );

    for (const method of methods) {
      const response = await (
        target as unknown as Record<string, (...args: unknown[]) => Promise<{ status: number }>>
      )[method]?.(staff, {
        tenantId: "t-1",
        orderId: "o-1",
        orderIds: ["o-1"],
        paymentIntentId: "p-1",
        from: "2026-10-06",
        to: "2026-10-13",
        timezone: "Africa/Cairo",
        currency: "EGP",
      });
      expect(response?.status, method).toBe(403);
    }
    expect(asked).toHaveLength(methods.length);
  });

  describe("fulfillmentsOfOrders (Plan 3B: the orders list's fulfillment status)", () => {
    it("asks for orders:read — not fulfillment:read — and reads the whole page in one call", async () => {
      const { guard, asked } = guardAnswering(true);
      const getByOrders = vi.fn().mockResolvedValue({ status: 200, body: [] });
      const target = controller(guard, { fulfillment: { getByOrders } });

      const response = await target.fulfillmentsOfOrders(staff, {
        tenantId: "t-1",
        orderIds: ["o-1", "o-2", "o-3"],
      });

      expect(response.status).toBe(200);
      expect(asked).toEqual(["orders:read"]);
      expect(getByOrders).toHaveBeenCalledTimes(1);
      expect(getByOrders).toHaveBeenCalledWith({
        tenantId: "t-1",
        orderRefs: ["o-1", "o-2", "o-3"],
      });
    });
  });

  describe("salesReport (Plan 3D: the dashboard's figures)", () => {
    const shop = { timezone: "Africa/Cairo", currency: "EGP" };
    const input = { tenantId: "t-1", from: "2026-10-06", to: "2026-10-13", ...shop };
    const summary = (totalSalesMinor: number) => ({
      status: 200,
      body: { totalSalesMinor, ordersCount: 0, openOrderIds: [] },
    });

    it("asks for orders:read only, and sums the range and the one before it in the shop's zone and currency", async () => {
      const { guard, asked } = guardAnswering(true);
      const salesSummary = vi
        .fn()
        .mockResolvedValueOnce(summary(300))
        .mockResolvedValueOnce(summary(200));
      const target = controller(guard, {
        orders: { salesSummary } as unknown as OrderController,
      });

      const response = await target.salesReport(staff, input);

      expect(asked).toEqual(["orders:read"]);
      expect(salesSummary).toHaveBeenNthCalledWith(1, {
        tenantId: "t-1",
        from: "2026-10-06",
        to: "2026-10-13",
        ...shop,
        includeOpenOrderIds: true,
      });
      expect(salesSummary).toHaveBeenNthCalledWith(2, {
        tenantId: "t-1",
        from: "2026-09-29",
        to: "2026-10-06",
        ...shop,
      });
      expect(response).toEqual({
        status: 200,
        body: {
          current: { totalSalesMinor: 300, ordersCount: 0, openOrderIds: [] },
          previous: { totalSalesMinor: 200, ordersCount: 0, openOrderIds: [] },
          currency: "EGP",
          timezone: "Africa/Cairo",
        },
      });
    });

    it("compares with the range the caller names, when it names one", async () => {
      const { guard } = guardAnswering(true);
      const salesSummary = vi.fn().mockResolvedValue(summary(0));
      const target = controller(guard, {
        orders: { salesSummary } as unknown as OrderController,
      });

      await target.salesReport(staff, {
        ...input,
        previous: { from: "2026-09-01", to: "2026-09-14" },
      });

      expect(salesSummary).toHaveBeenNthCalledWith(2, {
        tenantId: "t-1",
        from: "2026-09-01",
        to: "2026-09-14",
        ...shop,
      });
    });

    it("answers the failure of the current range without reading the previous one", async () => {
      const { guard } = guardAnswering(true);
      const salesSummary = vi.fn().mockResolvedValue({ status: 422, body: {} });
      const target = controller(guard, {
        orders: { salesSummary } as unknown as OrderController,
      });

      const response = await target.salesReport(staff, input);

      expect(response.status).toBe(422);
      expect(salesSummary).toHaveBeenCalledTimes(1);
    });

    it("answers the failure of the previous range instead of a half report", async () => {
      const { guard } = guardAnswering(true);
      const salesSummary = vi
        .fn()
        .mockResolvedValueOnce(summary(300))
        .mockResolvedValueOnce({ status: 500, body: {} });
      const target = controller(guard, {
        orders: { salesSummary } as unknown as OrderController,
      });

      const response = await target.salesReport(staff, input);

      expect(response.status).toBe(500);
    });
  });

  describe("paymentIntentOf (Plan 3B: how the customer is paying)", () => {
    it("asks for orders:read and reads the intent in the caller's tenant", async () => {
      const { guard, asked } = guardAnswering(true);
      const getPaymentIntent = vi.fn().mockResolvedValue({ status: 200, body: {} });
      const target = controller(guard, {
        payments: { getPaymentIntent, refundLifecycle: vi.fn() },
      });

      const response = await target.paymentIntentOf(staff, {
        tenantId: "t-1",
        paymentIntentId: "intent-1",
      });

      expect(response.status).toBe(200);
      expect(asked).toEqual(["orders:read"]);
      expect(getPaymentIntent).toHaveBeenCalledWith({
        tenantId: "t-1",
        paymentIntentId: "intent-1",
      });
    });
  });

  // G-127: "Refund" on the order page moves money through Payments, then records the order refund.
  describe("refundOrder (refund the linked payment first; record the order refund only after it)", () => {
    const input = { tenantId: "t-1", orderId: "o-1" };

    function setup(options: {
      order?: { status: string; paymentRef?: string } | null;
      intent?: { status: string; amountMinor?: number; currency?: string } | null;
      refundLifecycle?: ReturnType<typeof vi.fn>;
    }) {
      const { guard, asked } = guardAnswering(true);
      const calls: string[] = [];
      const getOrder = vi.fn().mockImplementation(() => {
        calls.push("orders.getOrder");
        return Promise.resolve(
          options.order === null
            ? { status: 404, body: { message: "Order not found" } }
            : {
                status: 200,
                body: options.order ?? { status: "payment_received", paymentRef: "intent-1" },
              },
        );
      });
      const refund = vi.fn().mockImplementation(() => {
        calls.push("orders.refund");
        return Promise.resolve({ status: 200, body: { orderId: "o-1", status: "refunded" } });
      });
      const getPaymentIntent = vi.fn().mockImplementation(() => {
        calls.push("payments.getPaymentIntent");
        return Promise.resolve(
          options.intent === null
            ? { status: 404, body: {} }
            : {
                status: 200,
                body: {
                  status: { value: options.intent?.status ?? "captured" },
                  amount: {
                    amountMinor: options.intent?.amountMinor ?? 3998,
                    currency: options.intent?.currency ?? "EGP",
                  },
                },
              },
        );
      });
      const refundLifecycle =
        options.refundLifecycle ??
        vi.fn().mockImplementation(() => {
          calls.push("payments.refundLifecycle");
          return Promise.resolve({ status: 200, body: { status: "refunded" } });
        });
      const target = controller(guard, {
        orders: { getOrder, refund } as unknown as OrderController,
        payments: { getPaymentIntent, refundLifecycle },
      });
      return { target, calls, asked, refund, refundLifecycle, getPaymentIntent };
    }

    it("asks for orders:refund only, refunds the FULL intent amount read server-side, then records the order refund", async () => {
      const { target, calls, asked, refundLifecycle } = setup({
        intent: { status: "captured", amountMinor: 3998, currency: "EGP" },
      });

      const response = await target.refundOrder(staff, input);

      expect(response).toEqual({ status: 200, body: { orderId: "o-1", status: "refunded" } });
      expect(asked).toEqual(["orders:refund"]);
      expect(refundLifecycle).toHaveBeenCalledWith({
        tenantId: "t-1",
        paymentIntentId: "intent-1",
        amountMinor: 3998,
        currency: "EGP",
        idempotencyKey: "o-1:order-refund",
      });
      expect(calls).toEqual([
        "orders.getOrder",
        "payments.getPaymentIntent",
        "payments.refundLifecycle",
        "orders.refund",
      ]);
    });

    it("leaves the order untouched when Payments refuses the refund", async () => {
      const refundLifecycle = vi.fn().mockResolvedValue({
        status: 409,
        body: { message: "Refund exceeds the captured amount" },
      });
      const { target, refund } = setup({ refundLifecycle });

      const response = await target.refundOrder(staff, input);

      expect(response.status).toBe(409);
      expect(refund).not.toHaveBeenCalled();
    });

    it("leaves the order untouched when the provider fails, and answers 502 without the provider's message", async () => {
      const refundLifecycle = vi.fn().mockRejectedValue(new Error("psp said: card 4242 declined"));
      const { target, refund } = setup({ refundLifecycle });

      const response = await target.refundOrder(staff, input);

      expect(response.status).toBe(502);
      expect(JSON.stringify(response.body)).not.toContain("4242");
      expect(refund).not.toHaveBeenCalled();
    });

    it("a legacy paid order has no linked payment: only the order refund is recorded", async () => {
      const { target, calls } = setup({ order: { status: "paid" } });

      const response = await target.refundOrder(staff, input);

      expect(response.status).toBe(200);
      expect(calls).toEqual(["orders.getOrder", "orders.refund"]);
    });

    it("an order the policy refuses never reaches Payments; the standard refusal is Orders' own", async () => {
      const { target, calls } = setup({
        order: { status: "payment_requested", paymentRef: "intent-1" },
      });

      await target.refundOrder(staff, input);

      expect(calls).toEqual(["orders.getOrder", "orders.refund"]);
    });

    it("refuses a paid-state order that has no payment to refund, changing nothing", async () => {
      const { target, calls } = setup({ order: { status: "payment_received" } });

      const response = await target.refundOrder(staff, input);

      expect(response.status).toBe(409);
      expect(calls).toEqual(["orders.getOrder"]);
    });

    it.each(["created", "cancelled", "partially_refunded", "authorized"])(
      "refuses when the linked payment is %s: there is no captured money to give back",
      async (status) => {
        const { target, calls, refundLifecycle } = setup({ intent: { status } });

        const response = await target.refundOrder(staff, input);

        expect(response.status).toBe(409);
        expect(refundLifecycle).not.toHaveBeenCalled();
        expect(calls).not.toContain("orders.refund");
      },
    );

    it("resumes: a payment already refunded by an earlier attempt is not refunded twice, and the order refund is recorded", async () => {
      const { target, calls, refundLifecycle } = setup({ intent: { status: "refunded" } });

      const response = await target.refundOrder(staff, input);

      expect(response.status).toBe(200);
      expect(refundLifecycle).not.toHaveBeenCalled();
      expect(calls).toEqual(["orders.getOrder", "payments.getPaymentIntent", "orders.refund"]);
    });

    it("answers the order lookup's own failure when the order does not exist", async () => {
      const { target, calls } = setup({ order: null });

      const response = await target.refundOrder(staff, input);

      expect(response.status).toBe(404);
      expect(calls).toEqual(["orders.getOrder"]);
    });
  });
});
