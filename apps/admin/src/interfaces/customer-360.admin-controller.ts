import type { Principal } from "@platform/contracts";
import type { Customer360Controller } from "@platform/customer-360";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface Customer360AdminControllerDeps {
  readonly customer360: Customer360Controller;
  readonly guard: AdminGuard;
}

/** Wires the Customer 360 admin screen to the Customer-360 context's read side (Sprint S1). Pure delegation, read-only; every action authorizes first (RBAC seam, ADR-0007). */
export class Customer360AdminController {
  private readonly customer360: Customer360Controller;
  private readonly guard: AdminGuard;

  constructor(deps: Customer360AdminControllerDeps) {
    this.customer360 = deps.customer360;
    this.guard = deps.guard;
  }

  async getProfile(
    principal: Principal,
    input: Parameters<Customer360Controller["getProfile"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customer360:read");
    if (denied) return denied;
    return this.customer360.getProfile(input);
  }

  async getIdentityTimeline(
    principal: Principal,
    input: Parameters<Customer360Controller["getIdentityTimeline"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customer360:read");
    if (denied) return denied;
    return this.customer360.getIdentityTimeline(input);
  }

  async getJourneyTimeline(
    principal: Principal,
    input: Parameters<Customer360Controller["getJourneyTimeline"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customer360:read");
    if (denied) return denied;
    return this.customer360.getJourneyTimeline(input);
  }

  async getJourneyState(
    principal: Principal,
    input: Parameters<Customer360Controller["getJourneyState"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "customer360:read");
    if (denied) return denied;
    return this.customer360.getJourneyState(input);
  }
}
