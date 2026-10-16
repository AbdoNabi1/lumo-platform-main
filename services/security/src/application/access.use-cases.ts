import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError } from "@platform/utils";
import type { PolicyEffect } from "../domain/policy";
import type { RiskSignals, TrustSignals } from "../domain/risk";
import { PermissionSpec } from "../domain/value-objects/permission-spec";
import { ResourceUrn } from "../domain/value-objects/resource-urn";
import { SecurityScope, type SecurityScopeProps } from "../domain/value-objects/security-scope";
import type { ZeroTrustContext } from "../domain/zero-trust";
import { loadRoleClosure } from "./authz-helpers";
import { recordAudit, securityEvent, type SecurityDeps } from "./deps";

export interface EvaluateAccessInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
  /** The required permission, `"<resource>:<action>"`. */
  readonly permission: string;
  readonly sessionId?: string;
  readonly resource?: string;
  readonly scope?: SecurityScopeProps;
  readonly environment?: string;
  readonly deviceRef?: string;
  /** Explicit policy to apply; otherwise the principal's tenant default profile policy. */
  readonly policyKey?: string;
  readonly risk?: RiskSignals;
  readonly trust?: TrustSignals;
}

export interface AccessDecisionOutput {
  readonly effect: PolicyEffect;
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly policyKey: string | null;
  readonly policyVersion: number | null;
  readonly risk: number;
  readonly trust: number;
  readonly roleKeys: readonly string[];
  readonly auditId: string;
}

/**
 * The **zero-trust access evaluation** — the platform's single authorization entry point. It
 * resolves identity + session + device + RBAC/ABAC permission + risk/trust + environment, applies
 * the governing policy's active version via the {@link ZeroTrustEvaluator}, records a WORM audit
 * record, publishes `security.access.evaluated`, and returns an explainable decision. Enforcement is
 * NOT performed here (frozen: `@platform/entitlement`/Keto enforce) — Security **decides**
 * (ADR-0023). Synchronous + pure of deep analysis by design (performance contract).
 */
export class EvaluateAccess implements UseCase<
  EvaluateAccessInput,
  AccessDecisionOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}

  async execute(input: EvaluateAccessInput): Promise<Result<AccessDecisionOutput, DomainError>> {
    const requiredSpec = PermissionSpec.parse(input.permission);
    if (!requiredSpec.ok) return err(requiredSpec.error);
    const now = this.deps.clock.now();

    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    const principalRef = principal?.externalId ?? input.principalExternalId;
    const tenantRef = principal?.tenantRef ?? null;

    // Session validity — human principals require a valid session; non-human principals are sessionless.
    let sessionValid: boolean;
    if (input.sessionId !== undefined) {
      const session = await this.deps.sessions.findById(input.sessionId, input.tenantId);
      sessionValid = session !== null && session.isValidAt(now);
    } else {
      sessionValid = principal !== null && principal.kind !== "human";
    }

    // Authorization (RBAC/ABAC) with scope + inheritance.
    const requestScope =
      input.scope === undefined ? SecurityScope.platform() : SecurityScope.of(input.scope);
    let roleKeys: readonly string[] = [];
    let permissionGranted = false;
    if (principal !== null) {
      const assignments = await this.deps.assignments.listByPrincipal(
        principal.id.toString(),
        input.tenantId,
      );
      const roles = await loadRoleClosure(
        this.deps.roles,
        assignments.map((a) => a.roleKey),
        input.tenantId,
      );
      const effective = this.deps.authorization.resolve({ assignments, roles, requestScope, now });
      permissionGranted = this.deps.authorization.isAuthorized(effective, requiredSpec.value);
      roleKeys = effective.roleKeys;
    }

    const deviceTrusted =
      input.deviceRef !== undefined
        ? await this.deps.deviceTrust.isTrusted(input.deviceRef)
        : false;
    const risk = this.deps.riskScorer.score(input.risk ?? {});
    this.deps.telemetry.recordRiskBand(risk.band);
    const trust = this.deps.trustScorer.score(input.trust ?? {});

    // Resolve governing policy: explicit key, else the tenant profile default.
    let policyKey = input.policyKey ?? null;
    if (policyKey === null && tenantRef !== null) {
      const profile = await this.deps.tenantProfiles.findByTenant(tenantRef, input.tenantId);
      policyKey = profile?.defaultPolicyKey ?? null;
    }
    const policy =
      policyKey !== null ? await this.deps.policies.findByKey(policyKey, input.tenantId) : null;
    const activeVersion = policy?.activePolicyVersion() ?? null;

    let resource: ResourceUrn | null = null;
    if (input.resource !== undefined) {
      const parsed = ResourceUrn.parse(input.resource);
      if (parsed.ok) resource = parsed.value;
    }

    const context: ZeroTrustContext = {
      principalActive: principal !== null && principal.isActive,
      sessionValid,
      permissionGranted,
      deviceTrusted,
      risk: risk.value,
      trust: trust.value,
      environment: input.environment ?? null,
      resource,
    };
    const decision = this.deps.zeroTrust.evaluate(
      context,
      activeVersion,
      this.deps.fragmentResolver,
    );

    this.recordTelemetry(decision.effect, permissionGranted);

    return this.deps.unitOfWork.run<Result<AccessDecisionOutput, DomainError>>(async (tx) => {
      const audit = await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef,
        action: requiredSpec.value.toString(),
        decision: decision.effect,
        resource: input.resource ?? null,
        tenantRef,
        metadata: {
          risk: String(risk.value),
          trust: String(trust.value),
          roles: String(roleKeys.length),
          policy: policyKey ?? "none",
          version: decision.policyVersion === null ? "none" : String(decision.policyVersion),
        },
      });
      await this.deps.outbox.publish(
        [
          securityEvent(
            this.deps,
            "access",
            audit.id,
            principalRef,
            "security.access.evaluated",
            decision.effect,
          ),
        ],
        input.tenantId,
        tx,
      );
      return ok({
        effect: decision.effect,
        allowed: decision.effect === "allow",
        reasons: decision.reasons,
        matchedRuleIds: decision.matchedRuleIds,
        policyKey,
        policyVersion: decision.policyVersion,
        risk: risk.value,
        trust: trust.value,
        roleKeys,
        auditId: audit.id,
      });
    });
  }

  private recordTelemetry(effect: PolicyEffect, permissionGranted: boolean): void {
    if (!permissionGranted) this.deps.telemetry.increment("security.auth.failed");
    if (effect === "allow") this.deps.telemetry.increment("security.access.allowed");
    else if (effect === "challenge") this.deps.telemetry.increment("security.access.challenged");
    else this.deps.telemetry.increment("security.access.denied");
  }
}

export interface VerifyAuditChainInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly tenantRef?: string | null;
}

export interface AuditChainReport {
  readonly valid: boolean;
  readonly count: number;
  readonly brokenAt?: number;
  readonly reason?: string;
}

/** Verifies the WORM audit ledger's hash chain (tamper evidence) for a tenant scope (Part 4). */
export class VerifyAuditChain implements UseCase<
  VerifyAuditChainInput,
  AuditChainReport,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: VerifyAuditChainInput): Promise<Result<AuditChainReport, DomainError>> {
    const records = await this.deps.auditLedger.list(input.tenantRef ?? null, input.tenantId);
    const verification = this.deps.auditChain.verify(records);
    return ok({
      valid: verification.valid,
      count: records.length,
      ...(verification.brokenAt !== undefined ? { brokenAt: verification.brokenAt } : {}),
      ...(verification.reason !== undefined ? { reason: verification.reason } : {}),
    });
  }
}
