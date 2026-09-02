import type { Principal } from "@platform/contracts";
import type { SecurityController } from "@platform/security";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SecuritySessionsAdminControllerDeps {
  readonly security: SecurityController;
  readonly guard: AdminGuard;
}

/**
 * S1.5.2 — Sessions & Authentication slice of the Security admin screen (session lifecycle,
 * authentication flow, device trust, MFA, risk evaluation). Pure delegation; every action
 * authorizes first (RBAC seam, ADR-0007/ADR-0023).
 */
export class SecuritySessionsAdminController {
  private readonly security: SecurityController;
  private readonly guard: AdminGuard;

  constructor(deps: SecuritySessionsAdminControllerDeps) {
    this.security = deps.security;
    this.guard = deps.guard;
  }

  async establishSession(
    principal: Principal,
    input: Parameters<SecurityController["establishSession"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:establish_session");
    if (denied) return denied;
    return this.security.establishSession(input);
  }

  async refreshSession(
    principal: Principal,
    input: Parameters<SecurityController["refreshSession"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:refresh_session");
    if (denied) return denied;
    return this.security.refreshSession(input);
  }

  async revokeSession(
    principal: Principal,
    input: Parameters<SecurityController["revokeSession"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:revoke_session");
    if (denied) return denied;
    return this.security.revokeSession(input);
  }

  async introspectSession(
    principal: Principal,
    input: Parameters<SecurityController["introspectSession"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:introspect_session");
    if (denied) return denied;
    return this.security.introspectSession(input);
  }

  async revokeAllSessions(
    principal: Principal,
    input: Parameters<SecurityController["revokeAllSessions"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:revoke_all_sessions");
    if (denied) return denied;
    return this.security.revokeAllSessions(input);
  }

  async registerAuthMethod(
    principal: Principal,
    input: Parameters<SecurityController["registerAuthMethod"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:register_auth_method");
    if (denied) return denied;
    return this.security.registerAuthMethod(input);
  }

  async authenticate(
    principal: Principal,
    input: Parameters<SecurityController["authenticate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:authenticate");
    if (denied) return denied;
    return this.security.authenticate(input);
  }

  async registerDevice(
    principal: Principal,
    input: Parameters<SecurityController["registerDevice"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:register_device");
    if (denied) return denied;
    return this.security.registerDevice(input);
  }

  async recordDeviceSignal(
    principal: Principal,
    input: Parameters<SecurityController["recordDeviceSignal"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:record_device_signal");
    if (denied) return denied;
    return this.security.recordDeviceSignal(input);
  }

  async trustDevice(
    principal: Principal,
    input: Parameters<SecurityController["trustDevice"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:trust_device");
    if (denied) return denied;
    return this.security.trustDevice(input);
  }

  async blockDevice(
    principal: Principal,
    input: Parameters<SecurityController["blockDevice"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:block_device");
    if (denied) return denied;
    return this.security.blockDevice(input);
  }

  async enrollMfa(
    principal: Principal,
    input: Parameters<SecurityController["enrollMfa"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:enroll_mfa");
    if (denied) return denied;
    return this.security.enrollMfa(input);
  }

  async verifyMfaEnrollment(
    principal: Principal,
    input: Parameters<SecurityController["verifyMfaEnrollment"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:verify_mfa_enrollment");
    if (denied) return denied;
    return this.security.verifyMfaEnrollment(input);
  }

  async generateBackupCodes(
    principal: Principal,
    input: Parameters<SecurityController["generateBackupCodes"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:generate_backup_codes");
    if (denied) return denied;
    return this.security.generateBackupCodes(input);
  }

  async revokeMfa(
    principal: Principal,
    input: Parameters<SecurityController["revokeMfa"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:revoke_mfa");
    if (denied) return denied;
    return this.security.revokeMfa(input);
  }

  async decideMfa(
    principal: Principal,
    input: Parameters<SecurityController["decideMfa"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:decide_mfa");
    if (denied) return denied;
    return this.security.decideMfa(input);
  }

  async registerMfaMethod(
    principal: Principal,
    input: Parameters<SecurityController["registerMfaMethod"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:register_mfa_method");
    if (denied) return denied;
    return this.security.registerMfaMethod(input);
  }

  async evaluateRisk(
    principal: Principal,
    input: Parameters<SecurityController["evaluateRisk"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:evaluate_risk");
    if (denied) return denied;
    return this.security.evaluateRisk(input);
  }

  /** Console read model — session explorer (Part 10). Not `present()`-wrapped upstream; wrapped here. */
  async sessionExplorer(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:session_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.sessionExplorer() };
  }

  /** Console read model — device explorer (Part 10). Wrapped here (see above). */
  async deviceExplorer(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:device_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.deviceExplorer() };
  }

  /** Console read model — risk explorer (Part 10). Synchronous upstream; wrapped here for uniformity. */
  async riskExplorer(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:risk_explorer");
    if (denied) return denied;
    return { status: 200, body: this.security.riskExplorer() };
  }
}
