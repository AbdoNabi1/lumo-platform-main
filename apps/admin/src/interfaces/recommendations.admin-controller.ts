import type { Principal } from "@platform/contracts";
import type { RecommendationsController } from "@platform/recommendations";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface RecommendationsAdminControllerDeps {
  readonly recommendations: RecommendationsController;
  readonly guard: AdminGuard;
}

/** Wires the Recommendations admin screen to the Recommendations context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class RecommendationsAdminController {
  private readonly recommendations: RecommendationsController;
  private readonly guard: AdminGuard;

  constructor(deps: RecommendationsAdminControllerDeps) {
    this.recommendations = deps.recommendations;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<RecommendationsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "recommendations:create");
    if (denied) return denied;
    return this.recommendations.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<RecommendationsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "recommendations:advance");
    if (denied) return denied;
    return this.recommendations.advance(input);
  }

  async generate(
    principal: Principal,
    input: Parameters<RecommendationsController["generate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "recommendations:generate");
    if (denied) return denied;
    return this.recommendations.generate(input);
  }

  async regenerate(
    principal: Principal,
    input: Parameters<RecommendationsController["regenerate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "recommendations:regenerate");
    if (denied) return denied;
    return this.recommendations.regenerate(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "recommendations:read");
    if (denied) return denied;
    return this.recommendations.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<RecommendationsController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "recommendations:read");
    if (denied) return denied;
    return this.recommendations.get(input);
  }
}
