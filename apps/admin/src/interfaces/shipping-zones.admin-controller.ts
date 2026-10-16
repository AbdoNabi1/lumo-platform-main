import type { Principal } from "@platform/contracts";
import type { ShippingZonesController } from "@platform/shipping";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ShippingZonesAdminControllerDeps {
  readonly zones: ShippingZonesController;
  readonly guard: AdminGuard;
}

/**
 * Wires Settings → Shipping and delivery to the Shipping context's zones and rates (Plan 3C). Pure
 * delegation: reads need `settings:read`, every write `settings:update` (the shop's settings, not a
 * shipment action), and each call authorizes the acting principal first (RBAC seam, ADR-0007).
 */
export class ShippingZonesAdminController {
  private readonly zones: ShippingZonesController;
  private readonly guard: AdminGuard;

  constructor(deps: ShippingZonesAdminControllerDeps) {
    this.zones = deps.zones;
    this.guard = deps.guard;
  }

  async list(
    principal: Principal,
    input: Parameters<ShippingZonesController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.zones.list(input);
  }

  async create(
    principal: Principal,
    input: Parameters<ShippingZonesController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.zones.create(input);
  }

  async update(
    principal: Principal,
    input: Parameters<ShippingZonesController["update"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.zones.update(input);
  }

  async remove(
    principal: Principal,
    input: Parameters<ShippingZonesController["remove"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.zones.remove(input);
  }

  async addRate(
    principal: Principal,
    input: Parameters<ShippingZonesController["addRate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.zones.addRate(input);
  }

  async updateRate(
    principal: Principal,
    input: Parameters<ShippingZonesController["updateRate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.zones.updateRate(input);
  }

  async deleteRate(
    principal: Principal,
    input: Parameters<ShippingZonesController["deleteRate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.zones.deleteRate(input);
  }
}
