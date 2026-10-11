import type { Principal } from "@platform/contracts";
import type { TaxSettingsController } from "@platform/finance";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface TaxSettingsAdminControllerDeps {
  readonly taxes: TaxSettingsController;
  readonly guard: AdminGuard;
}

/**
 * Wires Settings → Taxes and duties to the Finance context's tax settings (Plan 3C). Pure delegation:
 * reads need `settings:read`, every write `settings:update`, and each call authorizes the acting
 * principal first (RBAC seam, ADR-0007).
 */
export class TaxSettingsAdminController {
  private readonly taxes: TaxSettingsController;
  private readonly guard: AdminGuard;

  constructor(deps: TaxSettingsAdminControllerDeps) {
    this.taxes = deps.taxes;
    this.guard = deps.guard;
  }

  async get(
    principal: Principal,
    input: Parameters<TaxSettingsController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.taxes.get(input);
  }

  async update(
    principal: Principal,
    input: Parameters<TaxSettingsController["update"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.taxes.update(input);
  }

  async upsertRegion(
    principal: Principal,
    input: Parameters<TaxSettingsController["upsertRegion"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.taxes.upsertRegion(input);
  }

  async deleteRegion(
    principal: Principal,
    input: Parameters<TaxSettingsController["deleteRegion"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.taxes.deleteRegion(input);
  }
}
