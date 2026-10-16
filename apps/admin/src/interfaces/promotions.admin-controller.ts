import type { Principal } from "@platform/contracts";
import type { PromotionsController } from "@platform/promotions";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface PromotionsAdminControllerDeps {
  readonly promotions: PromotionsController;
  readonly guard: AdminGuard;
}

/** Wires the Promotions admin screen to the Promotions context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class PromotionsAdminController {
  private readonly promotions: PromotionsController;
  private readonly guard: AdminGuard;

  constructor(deps: PromotionsAdminControllerDeps) {
    this.promotions = deps.promotions;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<PromotionsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "promotions:create");
    if (denied) return denied;
    return this.promotions.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<PromotionsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "promotions:advance");
    if (denied) return denied;
    return this.promotions.advance(input);
  }

  async evaluate(
    principal: Principal,
    input: Parameters<PromotionsController["evaluate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "promotions:evaluate");
    if (denied) return denied;
    return this.promotions.evaluate(input);
  }

  async recordUsage(
    principal: Principal,
    input: Parameters<PromotionsController["recordUsage"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "promotions:record_usage");
    if (denied) return denied;
    return this.promotions.recordUsage(input);
  }

  async list(
    principal: Principal,
    input: Parameters<PromotionsController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "promotions:read");
    if (denied) return denied;
    return this.promotions.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<PromotionsController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "promotions:read");
    if (denied) return denied;
    return this.promotions.get(input);
  }
}
