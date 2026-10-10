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
    payments: unreachable<Pick<PaymentController, "getPaymentIntent">>("PaymentController"),
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
      expect.arrayContaining(["getOrder", "listOrders", "fulfillmentsOfOrders", "paymentIntentOf"]),
    );

    for (const method of methods) {
      const response = await (
        target as unknown as Record<string, (...args: unknown[]) => Promise<{ status: number }>>
      )[method]?.(staff, {
        tenantId: "t-1",
        orderId: "o-1",
        orderIds: ["o-1"],
        paymentIntentId: "p-1",
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

  describe("paymentIntentOf (Plan 3B: how the customer is paying)", () => {
    it("asks for orders:read and reads the intent in the caller's tenant", async () => {
      const { guard, asked } = guardAnswering(true);
      const getPaymentIntent = vi.fn().mockResolvedValue({ status: 200, body: {} });
      const target = controller(guard, { payments: { getPaymentIntent } });

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
});
