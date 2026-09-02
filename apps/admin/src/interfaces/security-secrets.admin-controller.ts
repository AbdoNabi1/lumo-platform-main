import type { Principal } from "@platform/contracts";
import type { SecurityController } from "@platform/security";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SecuritySecretsAdminControllerDeps {
  readonly security: SecurityController;
  readonly guard: AdminGuard;
}

/**
 * S1.5.4 — Secrets slice of the Security admin screen (credential rotation scheduling,
 * scheduler-driven due-rotation, emergency revoke, rotation lineage). Pure delegation; every
 * action authorizes first (RBAC seam, ADR-0007/ADR-0023).
 */
export class SecuritySecretsAdminController {
  private readonly security: SecurityController;
  private readonly guard: AdminGuard;

  constructor(deps: SecuritySecretsAdminControllerDeps) {
    this.security = deps.security;
    this.guard = deps.guard;
  }

  async scheduleCredentialRotation(
    principal: Principal,
    input: Parameters<SecurityController["scheduleCredentialRotation"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:schedule_credential_rotation");
    if (denied) return denied;
    return this.security.scheduleCredentialRotation(input);
  }

  async rotateDueCredentials(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:rotate_due_credentials");
    if (denied) return denied;
    return this.security.rotateDueCredentials();
  }

  async emergencyRevokeCredentials(
    principal: Principal,
    input: Parameters<SecurityController["emergencyRevokeCredentials"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:emergency_revoke_credentials");
    if (denied) return denied;
    return this.security.emergencyRevokeCredentials(input);
  }

  async getCredentialLineage(
    principal: Principal,
    input: Parameters<SecurityController["getCredentialLineage"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:get_credential_lineage");
    if (denied) return denied;
    return this.security.getCredentialLineage(input);
  }

  /** Console read model — secret explorer (Part 10). Not `present()`-wrapped upstream; wrapped here. */
  async secretExplorer(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:secret_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.secretExplorer() };
  }
}
