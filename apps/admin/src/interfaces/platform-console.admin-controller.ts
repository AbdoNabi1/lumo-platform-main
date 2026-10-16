import type { Principal } from "@platform/contracts";
import type { PlatformConsoleController } from "@platform/platform-console";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface PlatformConsoleAdminControllerDeps {
  readonly platformConsole: PlatformConsoleController;
  readonly guard: AdminGuard;
}

/** Wires the Platform Console admin screen (Sprint 5.6, ADR-0018 addendum-2 §J) — Morbeh-internal, read-model only. */
export class PlatformConsoleAdminController {
  private readonly platformConsole: PlatformConsoleController;
  private readonly guard: AdminGuard;

  constructor(deps: PlatformConsoleAdminControllerDeps) {
    this.platformConsole = deps.platformConsole;
    this.guard = deps.guard;
  }

  async getKpis(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "platform-console:kpis:read");
    if (denied) return denied;
    return this.platformConsole.getKpis();
  }
}
