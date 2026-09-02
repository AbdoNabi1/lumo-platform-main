import type { Principal } from "@platform/contracts";
import type { OrderController } from "@platform/orders";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface OrdersAdminControllerDeps {
  readonly orders: OrderController;
  readonly guard: AdminGuard;
}

/**
 * Wires the frozen **Orders** admin screen to the Orders context. Pure delegation — the screen's
 * `refund` action maps to `RefundOrder`, plus place/markPaid. Every action authorizes the acting
 * principal first (RBAC seam, ADR-0007; permissive until real RBAC lands). (Fulfillment + returns
 * are later growth-module concerns, not built.)
 */
export class OrdersAdminController {
  private readonly orders: OrderController;
  private readonly guard: AdminGuard;

  constructor(deps: OrdersAdminControllerDeps) {
    this.orders = deps.orders;
    this.guard = deps.guard;
  }

  async placeOrder(
    principal: Principal,
    input: Parameters<OrderController["place"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:place");
    if (denied) return denied;
    return this.orders.place(input);
  }

  async markOrderPaid(
    principal: Principal,
    input: Parameters<OrderController["markPaid"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:mark_paid");
    if (denied) return denied;
    return this.orders.markPaid(input);
  }

  async refundOrder(
    principal: Principal,
    input: Parameters<OrderController["refund"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:refund");
    if (denied) return denied;
    return this.orders.refund(input);
  }

  async createFromCheckout(
    principal: Principal,
    input: Parameters<OrderController["createFromCheckout"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:create_from_checkout");
    if (denied) return denied;
    return this.orders.createFromCheckout(input);
  }

  async advanceOrder(
    principal: Principal,
    input: Parameters<OrderController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:advance");
    if (denied) return denied;
    return this.orders.advance(input);
  }

  async requestPaymentCapture(
    principal: Principal,
    input: Parameters<OrderController["requestPaymentCapture"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:request_payment_capture");
    if (denied) return denied;
    return this.orders.requestPaymentCapture(input);
  }

  async requestFulfillment(
    principal: Principal,
    input: Parameters<OrderController["requestFulfillment"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:request_fulfillment");
    if (denied) return denied;
    return this.orders.requestFulfillment(input);
  }

  async getOrder(
    principal: Principal,
    input: Parameters<OrderController["getOrder"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.orders.getOrder(input);
  }

  async listOrders(
    principal: Principal,
    input: Parameters<OrderController["listOrders"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.orders.listOrders(input);
  }
}
