import type { Principal } from "@platform/contracts";
import type { AnalyticsConsoleController } from "@platform/analytics";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface AnalyticsAdminControllerDeps {
  readonly analytics: AnalyticsConsoleController;
  readonly guard: AdminGuard;
}

/** Wires the Analytics admin screen to the Analytics context's semantic-layer catalog (Sprint S1). Pure delegation, read-only; every action authorizes first (RBAC seam, ADR-0007). */
export class AnalyticsAdminController {
  private readonly analytics: AnalyticsConsoleController;
  private readonly guard: AdminGuard;

  constructor(deps: AnalyticsAdminControllerDeps) {
    this.analytics = deps.analytics;
    this.guard = deps.guard;
  }

  async listMetrics(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "analytics:read");
    if (denied) return denied;
    return this.analytics.listMetrics();
  }

  async getMetric(
    principal: Principal,
    input: Parameters<AnalyticsConsoleController["getMetric"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "analytics:read");
    if (denied) return denied;
    return this.analytics.getMetric(input);
  }

  async listDimensions(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "analytics:read");
    if (denied) return denied;
    return this.analytics.listDimensions();
  }

  async getDimension(
    principal: Principal,
    input: Parameters<AnalyticsConsoleController["getDimension"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "analytics:read");
    if (denied) return denied;
    return this.analytics.getDimension(input);
  }
}
