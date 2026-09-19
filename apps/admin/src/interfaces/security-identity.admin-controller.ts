import type { Principal } from "@platform/contracts";
import type { SecurityController } from "@platform/security";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SecurityIdentityAdminControllerDeps {
  readonly security: SecurityController;
  readonly guard: AdminGuard;
}

/**
 * S1.5.1 — Identity & Credentials slice of the Security admin screen (identity/principal
 * registration, credential issue/rotate/revoke, machine-identity governance, live identity
 * resolution). Pure delegation; every action authorizes first (RBAC seam, ADR-0007/ADR-0023).
 */
export class SecurityIdentityAdminController {
  private readonly security: SecurityController;
  private readonly guard: AdminGuard;

  constructor(deps: SecurityIdentityAdminControllerDeps) {
    this.security = deps.security;
    this.guard = deps.guard;
  }

  async registerPrincipal(
    principal: Principal,
    input: Parameters<SecurityController["registerPrincipal"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:register_principal");
    if (denied) return denied;
    return this.security.registerPrincipal(input);
  }

  async transitionPrincipal(
    principal: Principal,
    input: Parameters<SecurityController["transitionPrincipal"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:transition_principal");
    if (denied) return denied;
    return this.security.transitionPrincipal(input);
  }

  async issueCredential(
    principal: Principal,
    input: Parameters<SecurityController["issueCredential"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:issue_credential");
    if (denied) return denied;
    return this.security.issueCredential(input);
  }

  async rotateCredential(
    principal: Principal,
    input: Parameters<SecurityController["rotateCredential"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:rotate_credential");
    if (denied) return denied;
    return this.security.rotateCredential(input);
  }

  async revokeCredential(
    principal: Principal,
    input: Parameters<SecurityController["revokeCredential"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:revoke_credential");
    if (denied) return denied;
    return this.security.revokeCredential(input);
  }

  async governMachineIdentity(
    principal: Principal,
    input: Parameters<SecurityController["governMachineIdentity"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:govern_machine_identity");
    if (denied) return denied;
    return this.security.governMachineIdentity(input);
  }

  async suspendMachineIdentity(
    principal: Principal,
    input: Parameters<SecurityController["suspendMachineIdentity"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:suspend_machine_identity");
    if (denied) return denied;
    return this.security.suspendMachineIdentity(input);
  }

  async resolvePrincipal(
    principal: Principal,
    input: Parameters<SecurityController["resolvePrincipal"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:resolve_principal");
    if (denied) return denied;
    return this.security.resolvePrincipal(input);
  }

  async resolveMembership(
    principal: Principal,
    input: Parameters<SecurityController["resolveMembership"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:resolve_membership");
    if (denied) return denied;
    return this.security.resolveMembership(input);
  }

  async resolveOrganization(
    principal: Principal,
    input: Parameters<SecurityController["resolveOrganization"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:resolve_organization");
    if (denied) return denied;
    return this.security.resolveOrganization(input);
  }

  async resolveMachineIdentity(
    principal: Principal,
    input: Parameters<SecurityController["resolveMachineIdentity"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:resolve_machine_identity");
    if (denied) return denied;
    return this.security.resolveMachineIdentity(input);
  }

  /** Console read model — identity overview (Part 10). Not `present()`-wrapped upstream; wrapped here. */
  async identityOverview(principal: Principal, tenantId: string): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:identity_overview");
    if (denied) return denied;
    return { status: 200, body: await this.security.identityOverview(tenantId) };
  }

  /** Console read model — machine-identity explorer (Part 10). Wrapped here (see above). */
  async machineIdentityExplorer(principal: Principal, tenantId: string): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:machine_identity_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.machineIdentityExplorer(tenantId) };
  }
}
