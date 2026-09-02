import type { Principal } from "@platform/contracts";
import type { CheckoutController } from "@platform/checkout";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface CheckoutAdminControllerDeps {
  readonly checkout: CheckoutController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Checkout** admin screen to the Checkout context (Sprint 4.6 — Checkout's first HTTP
 * surface). Pure delegation over the session lifecycle: start/load-items/set-addresses/select-
 * shipping-payment/validate/tax/shipping-quote/promotion/recalculate/lock/expire/complete/fail/
 * generate-order-draft/generate-payment-intent-request. Every action authorizes the acting
 * principal first (RBAC seam, ADR-0007; permissive until real RBAC lands). Checkout is storefront/
 * saga-driven; exposed here through the admin transport only because it is the sole transport
 * built so far (`SPRINT_4_6_CHECKOUT_CORE_REPORT.md` §5).
 */
export class CheckoutAdminController {
  private readonly checkout: CheckoutController;
  private readonly guard: AdminGuard;

  constructor(deps: CheckoutAdminControllerDeps) {
    this.checkout = deps.checkout;
    this.guard = deps.guard;
  }

  async start(
    principal: Principal,
    input: Parameters<CheckoutController["start"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:start");
    if (denied) return denied;
    return this.checkout.start(input);
  }

  async loadItems(
    principal: Principal,
    input: Parameters<CheckoutController["loadItems"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:load_items");
    if (denied) return denied;
    return this.checkout.loadItems(input);
  }

  async setBillingAddress(
    principal: Principal,
    input: Parameters<CheckoutController["setBillingAddress"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:set_billing_address");
    if (denied) return denied;
    return this.checkout.setBillingAddress(input);
  }

  async setShippingAddress(
    principal: Principal,
    input: Parameters<CheckoutController["setShippingAddress"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:set_shipping_address");
    if (denied) return denied;
    return this.checkout.setShippingAddress(input);
  }

  async selectShipping(
    principal: Principal,
    input: Parameters<CheckoutController["selectShipping"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:select_shipping");
    if (denied) return denied;
    return this.checkout.selectShipping(input);
  }

  async selectPayment(
    principal: Principal,
    input: Parameters<CheckoutController["selectPayment"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:select_payment");
    if (denied) return denied;
    return this.checkout.selectPayment(input);
  }

  async validateCheckout(
    principal: Principal,
    input: Parameters<CheckoutController["validateCheckout"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:validate");
    if (denied) return denied;
    return this.checkout.validateCheckout(input);
  }

  async requestTaxCalculation(
    principal: Principal,
    input: Parameters<CheckoutController["requestTaxCalculation"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:request_tax");
    if (denied) return denied;
    return this.checkout.requestTaxCalculation(input);
  }

  async requestShippingQuote(
    principal: Principal,
    input: Parameters<CheckoutController["requestShippingQuote"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:request_shipping_quote");
    if (denied) return denied;
    return this.checkout.requestShippingQuote(input);
  }

  async validatePromotion(
    principal: Principal,
    input: Parameters<CheckoutController["validatePromotion"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:validate_promotion");
    if (denied) return denied;
    return this.checkout.validatePromotion(input);
  }

  async recalculateTotals(
    principal: Principal,
    input: Parameters<CheckoutController["recalculateTotals"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:recalculate");
    if (denied) return denied;
    return this.checkout.recalculateTotals(input);
  }

  async lock(
    principal: Principal,
    input: Parameters<CheckoutController["lock"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:lock");
    if (denied) return denied;
    return this.checkout.lock(input);
  }

  async expire(
    principal: Principal,
    input: Parameters<CheckoutController["expire"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:expire");
    if (denied) return denied;
    return this.checkout.expire(input);
  }

  async complete(
    principal: Principal,
    input: Parameters<CheckoutController["complete"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:complete");
    if (denied) return denied;
    return this.checkout.complete(input);
  }

  async fail(
    principal: Principal,
    input: Parameters<CheckoutController["fail"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:fail");
    if (denied) return denied;
    return this.checkout.fail(input);
  }

  async generateOrderDraft(
    principal: Principal,
    input: Parameters<CheckoutController["generateOrderDraft"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:generate_order_draft");
    if (denied) return denied;
    return this.checkout.generateOrderDraft(input);
  }

  async generatePaymentIntentRequest(
    principal: Principal,
    input: Parameters<CheckoutController["generatePaymentIntentRequest"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "checkout:generate_payment_intent_request");
    if (denied) return denied;
    return this.checkout.generatePaymentIntentRequest(input);
  }
}
