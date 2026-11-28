import type { ConnectionsController, SaveConnectionInput } from "@platform/ad-platforms";
import type { Principal } from "@platform/contracts";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface AdPlatformsAdminControllerDeps {
  readonly connections: ConnectionsController;
  readonly guard: AdminGuard;
}

/**
 * Settings → Ad platforms (Lead Site Part D1). Reading is `settings:read`, saving is `settings:update`
 * (admin-level, like the other Settings pages: the role table grants neither to viewer or operator).
 * Pure delegation after the guard. The visitor-facing public ids are NOT here: they have no staff
 * `Principal`, so `public-ad-platforms-routes.ts` calls the `publicReads.adPlatforms` closure instead.
 * Nothing of the delivery side (opened secrets) is reachable from this class.
 */
export class AdPlatformsAdminController {
  private readonly connections: ConnectionsController;
  private readonly guard: AdminGuard;

  constructor(deps: AdPlatformsAdminControllerDeps) {
    this.connections = deps.connections;
    this.guard = deps.guard;
  }

  async list(principal: Principal, input: { readonly tenantId: string }): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    return denied ?? this.connections.list(input);
  }

  async save(principal: Principal, input: SaveConnectionInput): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    return denied ?? this.connections.save(input);
  }
}
