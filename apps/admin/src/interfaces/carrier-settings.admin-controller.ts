import type { Principal } from "@platform/contracts";
import type { ShippingController } from "@platform/shipping";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export class CarrierSettingsAdminController {
  private readonly shipping: ShippingController;
  private readonly guard: AdminGuard;

  constructor(deps: { shipping: ShippingController; guard: AdminGuard }) {
    this.shipping = deps.shipping;
    this.guard = deps.guard;
  }

  async get(principal: Principal, input: { tenantId: string }): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:read_settings");
    if (denied) return denied;
    return this.shipping.getCarrierSettings(input);
  }

  async listEnabled(principal: Principal, input: { tenantId: string }): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:read");
    if (denied) return denied;
    return this.shipping.listEnabledCarriers(input);
  }

  async update(
    principal: Principal,
    input: Parameters<ShippingController["updateCarrierSettings"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:update_settings");
    if (denied) return denied;
    return this.shipping.updateCarrierSettings(input);
  }

  async rotateWebhookSecret(
    principal: Principal,
    input: { tenantId: string; carrierKey: string },
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "shipping:update_settings");
    if (denied) return denied;
    return this.shipping.rotateCarrierWebhookSecret(input);
  }
}
