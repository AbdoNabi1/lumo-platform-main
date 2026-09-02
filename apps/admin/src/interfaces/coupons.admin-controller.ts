import type { Principal } from "@platform/contracts";
import type { CouponsController } from "@platform/coupons";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface CouponsAdminControllerDeps {
  readonly coupons: CouponsController;
  readonly guard: AdminGuard;
}

/** Wires the Coupons admin screen to the Coupons context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class CouponsAdminController {
  private readonly coupons: CouponsController;
  private readonly guard: AdminGuard;

  constructor(deps: CouponsAdminControllerDeps) {
    this.coupons = deps.coupons;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<CouponsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "coupons:create");
    if (denied) return denied;
    return this.coupons.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<CouponsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "coupons:advance");
    if (denied) return denied;
    return this.coupons.advance(input);
  }

  async redeem(
    principal: Principal,
    input: Parameters<CouponsController["redeem"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "coupons:redeem");
    if (denied) return denied;
    return this.coupons.redeem(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "coupons:read");
    if (denied) return denied;
    return this.coupons.list(input);
  }
}
