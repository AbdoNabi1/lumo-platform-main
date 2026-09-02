import type { Principal } from "@platform/contracts";
import type { SecurityController } from "@platform/security";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SecurityAuthorizationAdminControllerDeps {
  readonly security: SecurityController;
  readonly guard: AdminGuard;
}

/**
 * S1.5.3 — Authorization slice of the Security admin screen (roles, policies, ReBAC relation
 * tuples, unified access checks, delegation, consent read, tenant security profile). Pure
 * delegation; every action authorizes first (RBAC seam, ADR-0007/ADR-0023).
 */
export class SecurityAuthorizationAdminController {
  private readonly security: SecurityController;
  private readonly guard: AdminGuard;

  constructor(deps: SecurityAuthorizationAdminControllerDeps) {
    this.security = deps.security;
    this.guard = deps.guard;
  }

  async defineRole(
    principal: Principal,
    input: Parameters<SecurityController["defineRole"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:define_role");
    if (denied) return denied;
    return this.security.defineRole(input);
  }

  async grantRolePermission(
    principal: Principal,
    input: Parameters<SecurityController["grantRolePermission"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:grant_role_permission");
    if (denied) return denied;
    return this.security.grantRolePermission(input);
  }

  async assignRole(
    principal: Principal,
    input: Parameters<SecurityController["assignRole"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:assign_role");
    if (denied) return denied;
    return this.security.assignRole(input);
  }

  async revokeRoleAssignment(
    principal: Principal,
    input: Parameters<SecurityController["revokeRoleAssignment"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:revoke_role_assignment");
    if (denied) return denied;
    return this.security.revokeRoleAssignment(input);
  }

  async definePolicy(
    principal: Principal,
    input: Parameters<SecurityController["definePolicy"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:define_policy");
    if (denied) return denied;
    return this.security.definePolicy(input);
  }

  async publishPolicyVersion(
    principal: Principal,
    input: Parameters<SecurityController["publishPolicyVersion"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:publish_policy_version");
    if (denied) return denied;
    return this.security.publishPolicyVersion(input);
  }

  async archivePolicy(
    principal: Principal,
    input: Parameters<SecurityController["archivePolicy"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:archive_policy");
    if (denied) return denied;
    return this.security.archivePolicy(input);
  }

  async simulatePolicy(
    principal: Principal,
    input: Parameters<SecurityController["simulatePolicy"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:simulate_policy");
    if (denied) return denied;
    return this.security.simulatePolicy(input);
  }

  async writeRelationTuple(
    principal: Principal,
    input: Parameters<SecurityController["writeRelationTuple"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:write_relation_tuple");
    if (denied) return denied;
    return this.security.writeRelationTuple(input);
  }

  async deleteRelationTuple(
    principal: Principal,
    input: Parameters<SecurityController["deleteRelationTuple"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:delete_relation_tuple");
    if (denied) return denied;
    return this.security.deleteRelationTuple(input);
  }

  async checkAccess(
    principal: Principal,
    input: Parameters<SecurityController["checkAccess"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:check_access");
    if (denied) return denied;
    return this.security.checkAccess(input);
  }

  async evaluateAccess(
    principal: Principal,
    input: Parameters<SecurityController["evaluateAccess"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:evaluate_access");
    if (denied) return denied;
    return this.security.evaluateAccess(input);
  }

  async registerPolicyFragment(
    principal: Principal,
    input: Parameters<SecurityController["registerPolicyFragment"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:register_policy_fragment");
    if (denied) return denied;
    return this.security.registerPolicyFragment(input);
  }

  async registerPermission(
    principal: Principal,
    input: Parameters<SecurityController["registerPermission"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:register_permission");
    if (denied) return denied;
    return this.security.registerPermission(input);
  }

  async grantDelegation(
    principal: Principal,
    input: Parameters<SecurityController["grantDelegation"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:grant_delegation");
    if (denied) return denied;
    return this.security.grantDelegation(input);
  }

  async revokeDelegation(
    principal: Principal,
    input: Parameters<SecurityController["revokeDelegation"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:revoke_delegation");
    if (denied) return denied;
    return this.security.revokeDelegation(input);
  }

  async startImpersonation(
    principal: Principal,
    input: Parameters<SecurityController["startImpersonation"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:start_impersonation");
    if (denied) return denied;
    return this.security.startImpersonation(input);
  }

  async checkConsent(
    principal: Principal,
    input: Parameters<SecurityController["checkConsent"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:check_consent");
    if (denied) return denied;
    return this.security.checkConsent(input);
  }

  async configureTenantSecurity(
    principal: Principal,
    input: Parameters<SecurityController["configureTenantSecurity"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:configure_tenant_security");
    if (denied) return denied;
    return this.security.configureTenantSecurity(input);
  }

  /** Console read model — permission explorer (Part 10). Not `present()`-wrapped upstream; wrapped here. */
  async permissionExplorer(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:permission_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.permissionExplorer() };
  }

  /** Console read model — policy explorer (Part 10). Wrapped here (see above). */
  async policyExplorer(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:policy_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.policyExplorer() };
  }

  /** Console read model — security registry explorer (Part 10). Synchronous upstream; wrapped here. */
  async registryExplorer(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:registry_explorer");
    if (denied) return denied;
    return { status: 200, body: this.security.registryExplorer() };
  }
}
