import type { Principal } from "@platform/contracts";
import type { SecurityController } from "@platform/security";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SecurityAiGovernanceAdminControllerDeps {
  readonly security: SecurityController;
  readonly guard: AdminGuard;
}

/**
 * S1.5.6 — AI Governance slice of the Security admin screen (AI-identity budgets/quotas/
 * sandboxing/isolation, the AI action gate). Pure delegation; every action authorizes first
 * (RBAC seam, ADR-0007/ADR-0023). Last of the six S1.5 Security sub-milestones.
 */
export class SecurityAiGovernanceAdminController {
  private readonly security: SecurityController;
  private readonly guard: AdminGuard;

  constructor(deps: SecurityAiGovernanceAdminControllerDeps) {
    this.security = deps.security;
    this.guard = deps.guard;
  }

  async governAiIdentity(
    principal: Principal,
    input: Parameters<SecurityController["governAiIdentity"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:govern_ai_identity");
    if (denied) return denied;
    return this.security.governAiIdentity(input);
  }

  async suspendAiIdentity(
    principal: Principal,
    input: Parameters<SecurityController["suspendAiIdentity"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:suspend_ai_identity");
    if (denied) return denied;
    return this.security.suspendAiIdentity(input);
  }

  async checkAiAction(
    principal: Principal,
    input: Parameters<SecurityController["checkAiAction"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:check_ai_action");
    if (denied) return denied;
    return this.security.checkAiAction(input);
  }

  /** Console read model — AI governance explorer (Part 10). Not `present()`-wrapped upstream; wrapped here. */
  async aiGovernanceExplorer(principal: Principal, tenantId: string): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:ai_governance_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.aiGovernanceExplorer(tenantId) };
  }
}
