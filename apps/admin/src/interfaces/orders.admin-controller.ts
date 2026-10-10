import type { Principal } from "@platform/contracts";
import type { FulfillmentController } from "@platform/fulfillment";
import type { OrderController } from "@platform/orders";
import type { PaymentController } from "@platform/payments";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface OrdersAdminControllerDeps {
  readonly orders: OrderController;
  /**
   * Plan 3B: the two read-only facts an order screen derives its Shopify-style statuses from. Both are
   * reached under `orders:read` — see {@link OrdersAdminController.fulfillmentsOfOrders}.
   */
  readonly fulfillment: Pick<FulfillmentController, "getByOrders">;
  readonly payments: Pick<PaymentController, "getPaymentIntent">;
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
  private readonly fulfillment: Pick<FulfillmentController, "getByOrders">;
  private readonly payments: Pick<PaymentController, "getPaymentIntent">;
  private readonly guard: AdminGuard;

  constructor(deps: OrdersAdminControllerDeps) {
    this.orders = deps.orders;
    this.fulfillment = deps.fulfillment;
    this.payments = deps.payments;
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

  /**
   * The fulfillment orders of a page of orders, in ONE read (Plan 3B) — what the orders list and the
   * order page derive `fulfillmentStatus` from. Authorized as `orders:read`, not `fulfillment:read`:
   * the status is part of what reading an order shows, and a staff member who may read orders must not
   * see a half-empty list because they lack the separate fulfillment screen's permission. It exposes
   * the fulfillment orders only to the order routes' own mapping, which keeps nothing but the status.
   */
  async fulfillmentsOfOrders(
    principal: Principal,
    input: { readonly tenantId: string; readonly orderIds: readonly string[] },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.fulfillment.getByOrders({ tenantId: input.tenantId, orderRefs: input.orderIds });
  }

  /** The payment intent linked to an order (Plan 3B) — only its provider is shown on the order page. Authorized as `orders:read`. */
  async paymentIntentOf(
    principal: Principal,
    input: { readonly tenantId: string; readonly paymentIntentId: string },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    return this.payments.getPaymentIntent(input);
  }
}
