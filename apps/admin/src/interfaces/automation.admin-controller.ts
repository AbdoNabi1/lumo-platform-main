import type { Principal } from "@platform/contracts";
import type { AutomationController } from "@platform/automation";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface AutomationAdminControllerDeps {
  readonly automation: AutomationController;
  readonly guard: AdminGuard;
}

/** Wires the Automation admin screen to the Automation context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class AutomationAdminController {
  private readonly automation: AutomationController;
  private readonly guard: AdminGuard;

  constructor(deps: AutomationAdminControllerDeps) {
    this.automation = deps.automation;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<AutomationController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "automation:create");
    if (denied) return denied;
    return this.automation.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<AutomationController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "automation:advance");
    if (denied) return denied;
    return this.automation.advance(input);
  }

  async trigger(
    principal: Principal,
    input: Parameters<AutomationController["trigger"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "automation:trigger");
    if (denied) return denied;
    return this.automation.trigger(input);
  }

  async retryExecution(
    principal: Principal,
    input: Parameters<AutomationController["retryExecution"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "automation:retry_execution");
    if (denied) return denied;
    return this.automation.retryExecution(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "automation:read");
    if (denied) return denied;
    return this.automation.list(input);
  }
}
