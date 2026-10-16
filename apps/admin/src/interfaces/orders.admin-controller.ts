import type { Principal } from "@platform/contracts";
import type { FulfillmentController } from "@platform/fulfillment";
import { type OrderController, previousSalesRange, RefundPolicy } from "@platform/orders";
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
  readonly payments: Pick<PaymentController, "getPaymentIntent" | "refundLifecycle">;
  readonly guard: AdminGuard;
}

const refundPolicy = new RefundPolicy();

/** What the refund needs from the entities the two contexts answer with; anything else is not read. */
interface OrderForRefund {
  readonly status: string;
  readonly paymentRef?: string;
}
interface IntentForRefund {
  readonly status: { readonly value: string };
  readonly amount: { readonly amountMinor: number; readonly currency: string };
}

function conflict(message: string): AdminResponse {
  return { status: 409, body: { message } };
}

/**
 * "Refund" on the order page (G-127), Shopify's model: the money moves through Payments, and only a
 * refund that succeeded is recorded on the order.
 *
 *  1. An order the policy refuses (or a legacy `paid` order, which never had a linked payment) goes
 *     straight to Orders' own refund, which answers with its standard refusal / records the status.
 *  2. Otherwise the order's linked payment intent must be `captured`. The amount is read HERE, from
 *     the intent — the request carries none — and the whole amount is refunded. Card intents go to
 *     the provider, cash on delivery is recorded as returned outside the platform: that choice is
 *     Payments' (`RefundPaymentLifecycle`), by the provider's declared capabilities.
 *  3. The idempotency key is the order's, so a retry — a double click, or a retry after the order
 *     refund failed to save — never refunds the money twice; an intent that is already `refunded` is
 *     not refunded again and the order refund is simply recorded.
 *  4. Only after Payments answered 200 is the order refund recorded. If Payments refuses or throws,
 *     nothing on the order changes. A provider failure answers 502 with no provider text.
 *
 * Authorized as `orders:refund` alone: the payment refund is part of refunding the order, like the
 * payment reads in `paymentIntentOf` are part of reading it.
 */
async function refundOrderThroughPayments(
  orders: OrderController,
  payments: Pick<PaymentController, "getPaymentIntent" | "refundLifecycle">,
  input: Parameters<OrderController["refund"]>[0],
): Promise<AdminResponse> {
  const found = await orders.getOrder({ tenantId: input.tenantId, orderId: input.orderId });
  if (found.status !== 200) return found;
  const order = found.body as OrderForRefund;

  if (!refundPolicy.canRefund(order.status as Parameters<RefundPolicy["canRefund"]>[0])) {
    return orders.refund(input);
  }
  if (order.paymentRef === undefined) {
    if (order.status === "paid") return orders.refund(input);
    return conflict("This order has no payment to refund");
  }

  const read = await payments.getPaymentIntent({
    tenantId: input.tenantId,
    paymentIntentId: order.paymentRef,
  });
  if (read.status !== 200) return conflict("The order's payment could not be found");
  const intent = read.body as IntentForRefund;

  if (intent.status.value !== "refunded") {
    if (intent.status.value !== "captured") {
      return conflict("The order's payment has not been captured, so there is nothing to refund");
    }
    let refunded: AdminResponse;
    try {
      refunded = await payments.refundLifecycle({
        tenantId: input.tenantId,
        paymentIntentId: order.paymentRef,
        amountMinor: intent.amount.amountMinor,
        currency: intent.amount.currency,
        idempotencyKey: `${input.orderId}:order-refund`,
      });
    } catch {
      return { status: 502, body: { message: "The refund could not be completed" } };
    }
    if (refunded.status !== 200) return refunded;
  }
  return orders.refund(input);
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
  private readonly payments: Pick<PaymentController, "getPaymentIntent" | "refundLifecycle">;
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
    return refundOrderThroughPayments(this.orders, this.payments, input);
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

  /**
   * The dashboard's figures for `[from, to)` and for `previous` — by default the equal-length range
   * before it; "this month" names the same days of last month instead (Plan 3D) — in
   * the shop's own time zone and currency (read by the caller, see `TenancyAdminController.getStoreRegion`;
   * Orders holds no Tenancy dependency, which the multi-tenant boot guard forbids). Authorized as
   * `orders:read`. `openOrderIds` is asked for on the current range only, the comparison has no use for it.
   */
  async salesReport(
    principal: Principal,
    input: {
      readonly tenantId: string;
      readonly from: string;
      readonly to: string;
      readonly timezone: string;
      readonly currency: string;
      readonly previous?: { readonly from: string; readonly to: string };
    },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "orders:read");
    if (denied) return denied;
    const { tenantId, timezone, currency } = input;
    const current = await this.orders.salesSummary({
      tenantId,
      from: input.from,
      to: input.to,
      timezone,
      currency,
      includeOpenOrderIds: true,
    });
    if (current.status !== 200) return current;
    const previous = await this.orders.salesSummary({
      tenantId,
      ...(input.previous ?? previousSalesRange(input.from, input.to)),
      timezone,
      currency,
    });
    if (previous.status !== 200) return previous;
    return {
      status: 200,
      body: { current: current.body, previous: previous.body, currency, timezone },
    };
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
