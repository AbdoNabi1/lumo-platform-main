import type { Principal } from "@platform/contracts";
import type { SenderDomainController } from "@platform/notifications";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SenderDomainAdminControllerDeps {
  readonly senderDomain: SenderDomainController;
  readonly guard: AdminGuard;
}

/**
 * Wave 2b (D43): authenticating the store's own sending domain. Reading is `settings:read`; starting
 * and verifying are `settings:update` (admin-level, like the other Settings pages). Pure delegation
 * after the guard; the tenant is always the request's own.
 */
export class SenderDomainAdminController {
  private readonly senderDomain: SenderDomainController;
  private readonly guard: AdminGuard;

  constructor(deps: SenderDomainAdminControllerDeps) {
    this.senderDomain = deps.senderDomain;
    this.guard = deps.guard;
  }

  async get(
    principal: Principal,
    input: Parameters<SenderDomainController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:read");
    if (denied) return denied;
    return this.senderDomain.get(input);
  }

  async start(
    principal: Principal,
    input: Parameters<SenderDomainController["start"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.senderDomain.start(input);
  }

  async verify(
    principal: Principal,
    input: Parameters<SenderDomainController["verify"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "settings:update");
    if (denied) return denied;
    return this.senderDomain.verify(input);
  }
}
