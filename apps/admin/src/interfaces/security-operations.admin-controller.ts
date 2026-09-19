import type { Principal } from "@platform/contracts";
import type { SecurityController } from "@platform/security";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SecurityOperationsAdminControllerDeps {
  readonly security: SecurityController;
  readonly guard: AdminGuard;
}

/**
 * S1.5.5 — Security Operations slice of the Security admin screen (incident response, threat
 * intelligence, compliance evaluation, audit-chain verification). Pure delegation; every action
 * authorizes first (RBAC seam, ADR-0007/ADR-0023).
 */
export class SecurityOperationsAdminController {
  private readonly security: SecurityController;
  private readonly guard: AdminGuard;

  constructor(deps: SecurityOperationsAdminControllerDeps) {
    this.security = deps.security;
    this.guard = deps.guard;
  }

  async openIncident(
    principal: Principal,
    input: Parameters<SecurityController["openIncident"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:open_incident");
    if (denied) return denied;
    return this.security.openIncident(input);
  }

  async triageIncident(
    principal: Principal,
    input: Parameters<SecurityController["triageIncident"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:triage_incident");
    if (denied) return denied;
    return this.security.triageIncident(input);
  }

  async mitigateIncident(
    principal: Principal,
    input: Parameters<SecurityController["mitigateIncident"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:mitigate_incident");
    if (denied) return denied;
    return this.security.mitigateIncident(input);
  }

  async resolveIncident(
    principal: Principal,
    input: Parameters<SecurityController["resolveIncident"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:resolve_incident");
    if (denied) return denied;
    return this.security.resolveIncident(input);
  }

  async closeIncident(
    principal: Principal,
    input: Parameters<SecurityController["closeIncident"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:close_incident");
    if (denied) return denied;
    return this.security.closeIncident(input);
  }

  async addIncidentEvidence(
    principal: Principal,
    input: Parameters<SecurityController["addIncidentEvidence"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:add_incident_evidence");
    if (denied) return denied;
    return this.security.addIncidentEvidence(input);
  }

  async checkThreatIndicator(
    principal: Principal,
    input: Parameters<SecurityController["checkThreatIndicator"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:check_threat_indicator");
    if (denied) return denied;
    return this.security.checkThreatIndicator(input);
  }

  async verifyAuditChain(
    principal: Principal,
    input: Parameters<SecurityController["verifyAuditChain"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:verify_audit_chain");
    if (denied) return denied;
    return this.security.verifyAuditChain(input);
  }

  async evaluateCompliance(
    principal: Principal,
    input: Parameters<SecurityController["evaluateCompliance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:evaluate_compliance");
    if (denied) return denied;
    return this.security.evaluateCompliance(input);
  }

  async registerComplianceRule(
    principal: Principal,
    input: Parameters<SecurityController["registerComplianceRule"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:register_compliance_rule");
    if (denied) return denied;
    return this.security.registerComplianceRule(input);
  }

  /** Console read model — incident explorer (Part 10). Not `present()`-wrapped upstream; wrapped here. */
  async incidentExplorer(principal: Principal, tenantId: string): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:incident_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.incidentExplorer(tenantId) };
  }

  /** Console read model — audit explorer (Part 10), optionally scoped to a tenant. Wrapped here. */
  async auditExplorer(
    principal: Principal,
    tenantId: string,
    tenantRef: string | null = null,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:audit_explorer");
    if (denied) return denied;
    return { status: 200, body: await this.security.auditExplorer(tenantId, tenantRef) };
  }

  /** Console read model — security dashboard (Part 10), optionally scoped to a tenant. Wrapped here. */
  async securityDashboard(
    principal: Principal,
    tenantId: string,
    tenantRef: string | null = null,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:security_dashboard");
    if (denied) return denied;
    return { status: 200, body: await this.security.securityDashboard(tenantId, tenantRef) };
  }

  /** Console read model — trust center (Part 10), optionally scoped to a tenant. Wrapped here. */
  async trustCenter(
    principal: Principal,
    tenantId: string,
    tenantRef: string | null = null,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:trust_center");
    if (denied) return denied;
    return { status: 200, body: await this.security.trustCenter(tenantId, tenantRef) };
  }

  /** Console read model — security analytics (Part 10). Synchronous upstream; wrapped here. */
  async securityAnalytics(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "security:security_analytics");
    if (denied) return denied;
    return { status: 200, body: this.security.securityAnalytics() };
  }
}
