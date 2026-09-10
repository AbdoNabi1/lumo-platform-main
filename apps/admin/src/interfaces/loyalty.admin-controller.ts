import type { Principal } from "@platform/contracts";
import type { LoyaltyController } from "@platform/loyalty";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface LoyaltyAdminControllerDeps {
  readonly loyalty: LoyaltyController;
  readonly guard: AdminGuard;
}

/** Wires the Loyalty admin screen to the Loyalty context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class LoyaltyAdminController {
  private readonly loyalty: LoyaltyController;
  private readonly guard: AdminGuard;

  constructor(deps: LoyaltyAdminControllerDeps) {
    this.loyalty = deps.loyalty;
    this.guard = deps.guard;
  }

  async open(
    principal: Principal,
    input: Parameters<LoyaltyController["open"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:open");
    if (denied) return denied;
    return this.loyalty.open(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<LoyaltyController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:advance");
    if (denied) return denied;
    return this.loyalty.advance(input);
  }

  async earn(
    principal: Principal,
    input: Parameters<LoyaltyController["earn"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:earn");
    if (denied) return denied;
    return this.loyalty.earn(input);
  }

  async spend(
    principal: Principal,
    input: Parameters<LoyaltyController["spend"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:spend");
    if (denied) return denied;
    return this.loyalty.spend(input);
  }

  async cashback(
    principal: Principal,
    input: Parameters<LoyaltyController["cashback"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:cashback");
    if (denied) return denied;
    return this.loyalty.cashback(input);
  }

  async redeem(
    principal: Principal,
    input: Parameters<LoyaltyController["redeem"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:redeem");
    if (denied) return denied;
    return this.loyalty.redeem(input);
  }

  async referral(
    principal: Principal,
    input: Parameters<LoyaltyController["referral"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:referral");
    if (denied) return denied;
    return this.loyalty.referral(input);
  }

  async list(
    principal: Principal,
    input: Parameters<LoyaltyController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:read");
    if (denied) return denied;
    return this.loyalty.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<LoyaltyController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "loyalty:read");
    if (denied) return denied;
    return this.loyalty.get(input);
  }
}
