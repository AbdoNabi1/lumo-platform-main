import type { Principal } from "@platform/contracts";
import type { PaymentController } from "@platform/payments";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface PaymentsAdminControllerDeps {
  readonly payments: PaymentController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Payments** admin screen to the Payments context (Sprint 4.8 — Payments' first admin
 * wiring). Pure delegation over the 5 backoffice-relevant lifecycle actions (create/authorize/
 * capture/refund/get) — `advance` (generic) and `recordWebhook` are saga/PSP-internal, not
 * exposed here, per `SPRINT_4_8_PAYMENTS_CORE_REPORT.md` §2's "5 versioned zod routes". Every
 * action authorizes the acting principal first (RBAC seam, ADR-0007; permissive until real RBAC
 * lands).
 */
export class PaymentsAdminController {
  private readonly payments: PaymentController;
  private readonly guard: AdminGuard;

  constructor(deps: PaymentsAdminControllerDeps) {
    this.payments = deps.payments;
    this.guard = deps.guard;
  }

  async createIntent(
    principal: Principal,
    input: Parameters<PaymentController["createIntentLifecycle"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:create_intent");
    if (denied) return denied;
    return this.payments.createIntentLifecycle(input);
  }

  async authorize(
    principal: Principal,
    input: Parameters<PaymentController["authorize"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:authorize");
    if (denied) return denied;
    return this.payments.authorize(input);
  }

  async capture(
    principal: Principal,
    input: Parameters<PaymentController["captureLifecycle"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:capture");
    if (denied) return denied;
    return this.payments.captureLifecycle(input);
  }

  async refund(
    principal: Principal,
    input: Parameters<PaymentController["refundLifecycle"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:refund");
    if (denied) return denied;
    return this.payments.refundLifecycle(input);
  }

  /** WP-13: the merchant's payment settings (which methods are offered). Never carries a credential. */
  async getSettings(
    principal: Principal,
    input: Parameters<PaymentController["getMerchantPaymentSettings"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:read_settings");
    if (denied) return denied;
    return this.payments.getMerchantPaymentSettings(input);
  }

  /** WP-13: enable/disable methods and set the merchant's Paymob credentials (write-only, sealed). */
  async updateSettings(
    principal: Principal,
    input: Parameters<PaymentController["updateMerchantPaymentSettings"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:update_settings");
    if (denied) return denied;
    return this.payments.updateMerchantPaymentSettings(input);
  }

  /** WP-13: the only thing that marks a cash-on-delivery payment paid. */
  async confirmCodCollection(
    principal: Principal,
    input: Parameters<PaymentController["confirmCodCollection"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:confirm_cod_collection");
    if (denied) return denied;
    return this.payments.confirmCodCollection(input);
  }

  async getPaymentIntent(
    principal: Principal,
    input: Parameters<PaymentController["getPaymentIntent"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "payments:read");
    if (denied) return denied;
    return this.payments.getPaymentIntent(input);
  }
}
