import type { Principal } from "@platform/contracts";
import type { ShippingController } from "@platform/shipping";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ShippingAdminControllerDeps {
  readonly shipping: ShippingController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Shipping** admin screen to the Shipping context (Sprint 4.10 — Shipping's first
 * admin wiring). Pure delegation over the 7 backoffice-relevant actions (create/advance
 * transitions/create label/void label/update tracking/retry/record carrier webhook), per
 * `SPRINT_4_10_SHIPPING_CORE_REPORT.md` §2's "7 versioned zod routes". Every action authorizes the
 * acting principal first (RBAC seam, ADR-0007; permissive until real RBAC lands).
 */
export class ShippingAdminController {
  private readonly shipping: ShippingController;
  private readonly guard: AdminGuard;

  constructor(deps: ShippingAdminControllerDeps) {
    this.shipping = deps.shipping;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ShippingController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:create");
    if (denied) return denied;
    return this.shipping.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ShippingController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:advance");
    if (denied) return denied;
    return this.shipping.advance(input);
  }

  async createLabel(
    principal: Principal,
    input: Parameters<ShippingController["createLabel"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:create_label");
    if (denied) return denied;
    return this.shipping.createLabel(input);
  }

  async voidLabel(
    principal: Principal,
    input: Parameters<ShippingController["voidLabel"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:void_label");
    if (denied) return denied;
    return this.shipping.voidLabel(input);
  }

  async updateTracking(
    principal: Principal,
    input: Parameters<ShippingController["updateTracking"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:update_tracking");
    if (denied) return denied;
    return this.shipping.updateTracking(input);
  }

  async retry(
    principal: Principal,
    input: Parameters<ShippingController["retry"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:retry");
    if (denied) return denied;
    return this.shipping.retry(input);
  }

  async getByFulfillment(
    principal: Principal,
    input: Parameters<ShippingController["getByFulfillment"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:read");
    if (denied) return denied;
    return this.shipping.getByFulfillment(input);
  }

  async recordWebhook(
    principal: Principal,
    input: Parameters<ShippingController["recordWebhook"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:record_webhook");
    if (denied) return denied;
    return this.shipping.recordWebhook(input);
  }
}
