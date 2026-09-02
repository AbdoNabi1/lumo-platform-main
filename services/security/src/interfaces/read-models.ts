import type { Registry } from "@platform/registry";
import { isHumanKind } from "../domain/value-objects/principal-kind";
import type { AuditChain } from "../domain/audit-chain";
import type { ComplianceControl } from "../domain/compliance-engine";
import type { PolicyFragment } from "../domain/policy-expression";
import type {
  AiGovernanceProfileRepository,
  AuditLedgerRepository,
  CredentialRepository,
  DeviceDirectory,
  IncidentRepository,
  MachineIdentityProfileRepository,
  PolicyRegistry,
  PrincipalDirectory,
  RoleRegistry,
  SessionRepository,
} from "../domain/repositories";
import type {
  AuthMethodSpec,
  MfaMethodSpec,
  PermissionDef,
} from "../domain/value-objects/auth-method";
import type { SecurityTelemetryPort } from "../application/ports";

export interface PrincipalOverviewRow {
  readonly externalId: string;
  readonly kind: string;
  readonly status: string;
  readonly tenantRef: string | null;
  readonly human: boolean;
}
export interface RoleSummaryRow {
  readonly key: string;
  readonly name: string;
  readonly permissionCount: number;
  readonly parentKey: string | null;
  readonly isTemplate: boolean;
  readonly status: string;
  readonly scope: string;
}
export interface PolicySummaryRow {
  readonly key: string;
  readonly mode: string;
  readonly status: string;
  readonly activeVersion: number | null;
}

export interface IdentityOverview {
  readonly total: number;
  readonly humans: number;
  readonly nonHumans: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly principals: readonly PrincipalOverviewRow[];
}

export interface PermissionExplorer {
  readonly roles: readonly RoleSummaryRow[];
  readonly policies: readonly PolicySummaryRow[];
}

export interface AuditTimelineRow {
  readonly sequence: number;
  readonly principalRef: string;
  readonly action: string;
  readonly decision: string;
  readonly resource: string | null;
  readonly occurredAt: string;
  readonly hash: string;
}
export interface AuditExplorer {
  readonly count: number;
  readonly chainValid: boolean;
  readonly brokenAt?: number;
  readonly timeline: readonly AuditTimelineRow[];
}

export interface SecurityDashboard {
  readonly metrics: Readonly<Record<string, number>>;
  readonly auditRecords: number;
  readonly chainValid: boolean;
}

export interface DeviceExplorerRow {
  readonly fingerprint: string;
  readonly principalRef: string | null;
  readonly trustLevel: string;
  readonly reputation: number;
  readonly anomalyCount: number;
  readonly lastSeenAt: string;
}
export interface DeviceExplorer {
  readonly total: number;
  readonly trusted: number;
  readonly blocked: number;
  readonly devices: readonly DeviceExplorerRow[];
}

export interface MachineIdentityRow {
  readonly principalRef: string;
  readonly owner: string;
  readonly purpose: string;
  readonly status: string;
  readonly allowedScopeCount: number;
  readonly rotationIntervalDays: number | null;
}
export interface MachineIdentityExplorer {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly identities: readonly MachineIdentityRow[];
}

export interface RegistrySummaryRow {
  readonly name: string;
  readonly entryCount: number;
  readonly entries: readonly {
    readonly key: string;
    readonly version: number;
    readonly status: string;
  }[];
}
export interface SecurityRegistryExplorer {
  readonly totalEntries: number;
  readonly registries: readonly RegistrySummaryRow[];
}

export interface SecurityReadModelDeps {
  readonly principals: PrincipalDirectory;
  readonly roles: RoleRegistry;
  readonly policies: PolicyRegistry;
  readonly devices: DeviceDirectory;
  readonly machineProfiles: MachineIdentityProfileRepository;
  readonly incidents: IncidentRepository;
  readonly sessions: SessionRepository;
  readonly credentials: CredentialRepository;
  readonly aiProfiles: AiGovernanceProfileRepository;
  readonly auditLedger: AuditLedgerRepository;
  readonly auditChain: AuditChain;
  readonly telemetry: SecurityTelemetryPort & {
    snapshot(): Readonly<Record<string, number>>;
    riskDistribution(): Readonly<Record<string, number>>;
  };
  // P2.0-D — versioned security registries (Registry Engine)
  readonly authMethodRegistry: Registry<AuthMethodSpec>;
  readonly mfaMethodRegistry: Registry<MfaMethodSpec>;
  readonly permissionRegistry: Registry<PermissionDef>;
  readonly policyFragments: Registry<PolicyFragment>;
  readonly complianceControlRegistry: Registry<ComplianceControl>;
}

export interface IncidentRow {
  readonly reference: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly category: string;
  readonly assignee: string | null;
}
export interface IncidentExplorer {
  readonly total: number;
  readonly open: number;
  readonly bySeverity: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly incidents: readonly IncidentRow[];
}

export interface TrustCenter {
  /** Composite 0–100 posture score (allow ratio, minus open-incident + audit-integrity penalties). */
  readonly postureScore: number;
  readonly auditChainValid: boolean;
  readonly auditRecords: number;
  readonly openIncidents: number;
  readonly criticalIncidents: number;
  readonly complianceControls: number;
  readonly frameworks: readonly string[];
}

export interface SecurityAnalytics {
  readonly loginSuccess: number;
  readonly loginFailure: number;
  readonly mfaSuccess: number;
  readonly mfaFailure: number;
  readonly accessAllowed: number;
  readonly accessDenied: number;
  readonly accessChallenged: number;
  readonly tokenRefreshed: number;
  readonly threatsIndicated: number;
  readonly sessionsRevoked: number;
  readonly riskDistribution: Readonly<Record<string, number>>;
}

// ── P2.0-F read models (§5 / §17 / §20) ──
export interface SessionRow {
  readonly id: string;
  readonly principalRef: string;
  readonly status: string;
  /** Upstream IdP session id when this session mirrors one (ADR-0031); null for Security-native. */
  readonly externalRef: string | null;
  readonly refreshCount: number;
  readonly riskAtLastEval: number;
  readonly impersonatedBy: string | null;
  readonly suspicious: boolean;
  readonly expiresAt: string;
}
export interface SessionExplorer {
  readonly total: number;
  readonly active: number;
  readonly revoked: number;
  readonly expired: number;
  readonly impersonations: number;
  readonly suspicious: number;
  readonly sessions: readonly SessionRow[];
}

export interface PolicyExplorerRow {
  readonly key: string;
  readonly mode: string;
  readonly status: string;
  readonly activeVersion: number | null;
  readonly versionCount: number;
}
export interface PolicyExplorer {
  readonly policies: readonly PolicyExplorerRow[];
  readonly fragments: readonly { readonly key: string; readonly version: number }[];
}

export interface RiskExplorer {
  readonly distribution: Readonly<Record<string, number>>;
  readonly total: number;
  readonly dominantBand: string | null;
  readonly threatsIndicated: number;
}

export interface SecretRow {
  readonly principalRef: string;
  readonly kind: string;
  readonly status: string;
  readonly rotationDueAt: string | null;
  readonly autoRotate: boolean;
}
export interface SecretExplorer {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly rotationDue: number;
  readonly credentials: readonly SecretRow[];
}

export interface AiGovernanceRow {
  readonly principalRef: string;
  readonly status: string;
  readonly tokenBudget: number | null;
  readonly tokensConsumed: number;
  readonly callQuota: number | null;
  readonly callsConsumed: number;
  readonly isolationLevel: string;
}
export interface AiGovernanceExplorer {
  readonly total: number;
  readonly active: number;
  readonly suspended: number;
  readonly identities: readonly AiGovernanceRow[];
}

/** A session is suspicious when it is an impersonation, was last evaluated at elevated risk, or has an unusual refresh count. */
const SUSPICIOUS_RISK = 50;
const SUSPICIOUS_REFRESH = 10;

/**
 * **Platform Console read models** (Part 10) — read-only projections only; no writes, no decisions.
 * The console/SOC surfaces (identity overview, permission explorer, audit explorer, security
 * dashboard) render these. Every mutation still flows through the use-cases (ADR-0023).
 */
export class SecurityConsoleReadModels {
  constructor(private readonly deps: SecurityReadModelDeps) {}

  async identityOverview(): Promise<IdentityOverview> {
    const principals = await this.deps.principals.listAll();
    const byStatus: Record<string, number> = {};
    let humans = 0;
    const rows: PrincipalOverviewRow[] = principals.map((p) => {
      const human = isHumanKind(p.kind);
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      if (human) humans += 1;
      return {
        externalId: p.externalId,
        kind: p.kind,
        status: p.status,
        tenantRef: p.tenantRef,
        human,
      };
    });
    return {
      total: rows.length,
      humans,
      nonHumans: rows.length - humans,
      byStatus,
      principals: rows,
    };
  }

  async permissionExplorer(): Promise<PermissionExplorer> {
    const roles = await this.deps.roles.listAll();
    const policies = await this.deps.policies.listAll();
    return {
      roles: roles.map((r) => ({
        key: r.key,
        name: r.name,
        permissionCount: r.permissions.length,
        parentKey: r.parentKey,
        isTemplate: r.isTemplate,
        status: r.status,
        scope: r.scope.key(),
      })),
      policies: policies.map((p) => ({
        key: p.key,
        mode: p.mode,
        status: p.status,
        activeVersion: p.activeVersionNumber,
      })),
    };
  }

  async auditExplorer(tenantRef: string | null = null): Promise<AuditExplorer> {
    const records = await this.deps.auditLedger.list(tenantRef);
    const verification = this.deps.auditChain.verify(records);
    return {
      count: records.length,
      chainValid: verification.valid,
      ...(verification.brokenAt !== undefined ? { brokenAt: verification.brokenAt } : {}),
      timeline: records.map((r) => ({
        sequence: r.sequence,
        principalRef: r.content.principalRef,
        action: r.content.action,
        decision: r.content.decision,
        resource: r.content.resource,
        occurredAt: r.content.occurredAt,
        hash: r.hash,
      })),
    };
  }

  async securityDashboard(tenantRef: string | null = null): Promise<SecurityDashboard> {
    const records = await this.deps.auditLedger.list(tenantRef);
    const verification = this.deps.auditChain.verify(records);
    return {
      metrics: this.deps.telemetry.snapshot(),
      auditRecords: records.length,
      chainValid: verification.valid,
    };
  }

  async deviceExplorer(): Promise<DeviceExplorer> {
    const devices = await this.deps.devices.listAll();
    let trusted = 0;
    let blocked = 0;
    const rows: DeviceExplorerRow[] = devices.map((d) => {
      if (d.trustLevel === "trusted") trusted += 1;
      if (d.trustLevel === "blocked") blocked += 1;
      return {
        fingerprint: d.fingerprint,
        principalRef: d.principalRef,
        trustLevel: d.trustLevel,
        reputation: d.reputation,
        anomalyCount: d.anomalyCount,
        lastSeenAt: d.lastSeenAt.toISOString(),
      };
    });
    return { total: rows.length, trusted, blocked, devices: rows };
  }

  async incidentExplorer(): Promise<IncidentExplorer> {
    const incidents = await this.deps.incidents.listAll();
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let open = 0;
    const rows: IncidentRow[] = incidents.map((i) => {
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
      if (i.isOpen) open += 1;
      return {
        reference: i.reference,
        title: i.title,
        severity: i.severity,
        status: i.status,
        category: i.category,
        assignee: i.assignee,
      };
    });
    return { total: rows.length, open, bySeverity, byStatus, incidents: rows };
  }

  /** The **Trust Center** (§12) — a read-only, real-data aggregate of the platform's security posture. */
  async trustCenter(tenantRef: string | null = null): Promise<TrustCenter> {
    const records = await this.deps.auditLedger.list(tenantRef);
    const auditChainValid = this.deps.auditChain.verify(records).valid;
    const incidents = await this.deps.incidents.listAll();
    const openIncidents = incidents.filter((i) => i.isOpen).length;
    const criticalIncidents = incidents.filter((i) => i.severity === "critical" && i.isOpen).length;
    const metrics = this.deps.telemetry.snapshot();
    const allowed = metrics["security.access.allowed"] ?? 0;
    const denied =
      (metrics["security.access.denied"] ?? 0) + (metrics["security.access.challenged"] ?? 0);
    const total = allowed + denied;
    const allowRatio = total === 0 ? 100 : Math.round((allowed / total) * 100);
    const posture = Math.max(
      0,
      allowRatio - openIncidents * 5 - criticalIncidents * 10 - (auditChainValid ? 0 : 40),
    );
    const frameworks = [
      ...new Set(this.deps.complianceControlRegistry.list().map((e) => e.value.framework)),
    ];
    return {
      postureScore: posture,
      auditChainValid,
      auditRecords: records.length,
      openIncidents,
      criticalIncidents,
      complianceControls: this.deps.complianceControlRegistry.list().length,
      frameworks,
    };
  }

  /** **Security Analytics** (§13) — named metric rollups + risk distribution from telemetry. */
  securityAnalytics(): SecurityAnalytics {
    const m = this.deps.telemetry.snapshot();
    const get = (key: string): number => m[key] ?? 0;
    return {
      loginSuccess: get("security.login.succeeded"),
      loginFailure: get("security.login.failed"),
      mfaSuccess: get("security.mfa.succeeded"),
      mfaFailure: get("security.mfa.failed"),
      accessAllowed: get("security.access.allowed"),
      accessDenied: get("security.access.denied"),
      accessChallenged: get("security.access.challenged"),
      tokenRefreshed: get("security.token.refreshed"),
      threatsIndicated: get("security.threat.indicated"),
      sessionsRevoked: get("security.session.revoked"),
      riskDistribution: this.deps.telemetry.riskDistribution(),
    };
  }

  /** **Session Intelligence** (§5) — every session with derived suspicious flags + rollup counts. */
  async sessionExplorer(): Promise<SessionExplorer> {
    const sessions = await this.deps.sessions.listAll();
    let active = 0;
    let revoked = 0;
    let expired = 0;
    let impersonations = 0;
    let suspicious = 0;
    const rows: SessionRow[] = sessions.map((s) => {
      const isSuspicious =
        s.impersonatedBy !== null ||
        s.riskAtLastEval >= SUSPICIOUS_RISK ||
        s.refreshCount >= SUSPICIOUS_REFRESH;
      if (s.status === "active") active += 1;
      else if (s.status === "revoked") revoked += 1;
      else expired += 1;
      if (s.impersonatedBy !== null) impersonations += 1;
      if (isSuspicious) suspicious += 1;
      return {
        id: s.id.toString(),
        principalRef: s.principalRef,
        status: s.status,
        externalRef: s.externalRef,
        refreshCount: s.refreshCount,
        riskAtLastEval: s.riskAtLastEval,
        impersonatedBy: s.impersonatedBy,
        suspicious: isSuspicious,
        expiresAt: s.expiresAt.toISOString(),
      };
    });
    return {
      total: rows.length,
      active,
      revoked,
      expired,
      impersonations,
      suspicious,
      sessions: rows,
    };
  }

  /** **Policy Explorer** (§17) — policies with versions + reusable fragments. */
  async policyExplorer(): Promise<PolicyExplorer> {
    const policies = await this.deps.policies.listAll();
    return {
      policies: policies.map((p) => ({
        key: p.key,
        mode: p.mode,
        status: p.status,
        activeVersion: p.activeVersionNumber,
        versionCount: p.versions.length,
      })),
      fragments: this.deps.policyFragments.list().map((e) => ({ key: e.key, version: e.version })),
    };
  }

  /** **Risk Explorer** (§17) — the risk-band distribution + dominant band + threat count. */
  riskExplorer(): RiskExplorer {
    const distribution = this.deps.telemetry.riskDistribution();
    const entries = Object.entries(distribution);
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    const dominantBand =
      entries.length === 0 ? null : entries.reduce((top, e) => (e[1] > top[1] ? e : top))[0];
    return {
      distribution,
      total,
      dominantBand,
      threatsIndicated: this.deps.telemetry.snapshot()["security.threat.indicated"] ?? 0,
    };
  }

  /** **Secret Explorer** (§17) — credentials + rotation status. Never exposes secret values. */
  async secretExplorer(): Promise<SecretExplorer> {
    const credentials = await this.deps.credentials.listAll();
    const byStatus: Record<string, number> = {};
    let rotationDue = 0;
    const rows: SecretRow[] = credentials.map((c) => {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      if (c.rotationDueAt !== null) rotationDue += 1;
      return {
        principalRef: c.principalRef,
        kind: c.kind,
        status: c.status,
        rotationDueAt: c.rotationDueAt === null ? null : c.rotationDueAt.toISOString(),
        autoRotate: c.autoRotate,
      };
    });
    return { total: rows.length, byStatus, rotationDue, credentials: rows };
  }

  /** **AI Governance Explorer** (§20) — governed AI identities with budgets/quotas/isolation. */
  async aiGovernanceExplorer(): Promise<AiGovernanceExplorer> {
    const profiles = await this.deps.aiProfiles.listAll();
    let active = 0;
    let suspended = 0;
    const rows: AiGovernanceRow[] = profiles.map((p) => {
      if (p.status === "active") active += 1;
      else suspended += 1;
      return {
        principalRef: p.principalRef,
        status: p.status,
        tokenBudget: p.tokenBudget,
        tokensConsumed: p.tokensConsumed,
        callQuota: p.callQuota,
        callsConsumed: p.callsConsumed,
        isolationLevel: p.isolationLevel,
      };
    });
    return { total: rows.length, active, suspended, identities: rows };
  }

  registryExplorer(): SecurityRegistryExplorer {
    const summarize = <T>(name: string, registry: Registry<T>): RegistrySummaryRow => {
      const entries = registry
        .list()
        .map((e) => ({ key: e.key, version: e.version, status: e.status }));
      return { name, entryCount: entries.length, entries };
    };
    const registries = [
      summarize("auth-methods", this.deps.authMethodRegistry),
      summarize("mfa-methods", this.deps.mfaMethodRegistry),
      summarize("permissions", this.deps.permissionRegistry),
      summarize("policy-fragments", this.deps.policyFragments),
      summarize("compliance-controls", this.deps.complianceControlRegistry),
    ];
    return { totalEntries: registries.reduce((sum, r) => sum + r.entryCount, 0), registries };
  }

  async machineIdentityExplorer(): Promise<MachineIdentityExplorer> {
    const profiles = await this.deps.machineProfiles.listAll();
    let active = 0;
    let suspended = 0;
    const rows: MachineIdentityRow[] = profiles.map((p) => {
      if (p.status === "active") active += 1;
      else suspended += 1;
      return {
        principalRef: p.principalRef,
        owner: p.owner,
        purpose: p.purpose,
        status: p.status,
        allowedScopeCount: p.allowedScopes.length,
        rotationIntervalDays: p.rotationIntervalDays,
      };
    });
    return { total: rows.length, active, suspended, identities: rows };
  }
}
