import { UniqueEntityId } from "@platform/domain";
import type { Prisma } from "@platform/db";
import {
  AiGovernanceProfile,
  type AiIsolationLevel,
  type AiGovernanceStatus,
} from "../domain/ai-governance-profile";
import { AuditRecord } from "../domain/audit-record";
import { Credential, type CredentialKind, type CredentialStatus } from "../domain/credential";
import { Delegation, type DelegationStatus } from "../domain/delegation";
import { Device, type DeviceSignal, type DeviceTrustLevel } from "../domain/device";
import {
  Incident,
  type EvidenceEntry,
  type IncidentSeverity,
  type IncidentStatus,
  type TimelineEntry,
} from "../domain/incident";
import {
  MachineIdentityProfile,
  type MachineIdentityStatus,
} from "../domain/machine-identity-profile";
import { MfaEnrollment, type MfaEnrollmentStatus } from "../domain/mfa-enrollment";
import {
  Policy,
  PolicyVersion,
  type PolicyEffect,
  type PolicyMode,
  type PolicyRule,
  type PolicyStatus,
} from "../domain/policy";
import { Principal } from "../domain/principal";
import { RelationTuple } from "../domain/relationship";
import { Role, type RoleStatus } from "../domain/role";
import { RoleAssignment, type AssignmentStatus } from "../domain/role-assignment";
import { Session, type SessionStatus } from "../domain/session";
import { TenantSecurityProfile, type IsolationTier } from "../domain/tenant-security-profile";
import type { MfaMethodKind } from "../domain/value-objects/auth-method";
import type { PrincipalKind, PrincipalStatus } from "../domain/value-objects/principal-kind";
import { RotationPolicy } from "../domain/value-objects/rotation-policy";
import { SecurityScope } from "../domain/value-objects/security-scope";

// Generic JSON coercion helpers — Prisma returns JSON columns as `unknown`; writes need `InputJsonValue`.
// Domain value-objects/collections are plain JSON-serializable data, but their *named* TS types don't
// carry Prisma's required index signature, so object-valued JSON payloads are widened at the boundary.
const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
const rec = (v: unknown): Record<string, string> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
const strArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const scope = (v: unknown): SecurityScope =>
  SecurityScope.of(v !== null && typeof v === "object" ? v : {});
const id = (value: string): UniqueEntityId => UniqueEntityId.from(value);

/** Common create-row fields for versioned aggregates (DB row starts at version 1 after first save). */
function base(
  entityId: string,
  tenantId: string,
): { id: string; tenantId: string; version: number } {
  return { id: entityId, tenantId, version: 1 };
}

// ── Principal ─────────────────────────────────────────────────────────────────────────────────────
export const PrincipalMapper = {
  toRow: (p: Principal, tenantId: string) => ({
    ...base(p.id.toString(), tenantId),
    externalId: p.externalId,
    kind: p.kind,
    displayName: p.displayName,
    subjectRef: p.subjectRef,
    tenantRef: p.tenantRef,
    status: p.status,
    attributes: { ...p.attributes },
  }),
  toUpdate: (p: Principal) => ({
    displayName: p.displayName,
    status: p.status,
    attributes: { ...p.attributes },
  }),
  toDomain: (r: {
    id: string;
    externalId: string;
    kind: string;
    displayName: string;
    subjectRef: string | null;
    tenantRef: string | null;
    status: string;
    attributes: unknown;
    version: number;
  }): Principal =>
    Principal.reconstitute(id(r.id), {
      externalId: r.externalId,
      kind: r.kind as PrincipalKind,
      displayName: r.displayName,
      subjectRef: r.subjectRef,
      tenantRef: r.tenantRef,
      status: r.status as PrincipalStatus,
      attributes: rec(r.attributes),
      version: r.version,
    }),
};

// ── Credential ────────────────────────────────────────────────────────────────────────────────────
function rotationFrom(v: unknown): RotationPolicy | null {
  if (v === null || typeof v !== "object") return null;
  const p = v as { intervalDays: number; graceSeconds: number; autoRotate: boolean };
  const created = RotationPolicy.create({
    intervalDays: p.intervalDays,
    graceSeconds: p.graceSeconds,
    autoRotate: p.autoRotate,
  });
  return created.ok ? created.value : null;
}
function rotationToJson(p: RotationPolicy | null): Prisma.InputJsonValue | undefined {
  return p === null
    ? undefined
    : json({
        intervalDays: p.intervalDays,
        graceSeconds: p.graceSeconds,
        autoRotate: p.autoRotate,
      });
}
export const CredentialMapper = {
  toRow: (c: Credential, tenantId: string) => ({
    ...base(c.id.toString(), tenantId),
    principalRef: c.principalRef,
    kind: c.kind,
    fingerprint: c.fingerprint,
    kmsKeyRef: c.kmsKeyRef,
    status: c.status,
    supersedesRef: c.supersedesRef,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
    rotationPolicy: rotationToJson(c.rotationPolicy) ?? undefined,
    rotationDueAt: c.rotationDueAt,
    graceUntil: c.graceUntil,
  }),
  toUpdate: (c: Credential) => ({
    status: c.status,
    kmsKeyRef: c.kmsKeyRef,
    rotationPolicy: rotationToJson(c.rotationPolicy) ?? undefined,
    rotationDueAt: c.rotationDueAt,
    graceUntil: c.graceUntil,
  }),
  toDomain: (r: {
    id: string;
    principalRef: string;
    kind: string;
    fingerprint: string;
    kmsKeyRef: string | null;
    status: string;
    supersedesRef: string | null;
    issuedAt: Date;
    expiresAt: Date | null;
    rotationPolicy: unknown;
    rotationDueAt: Date | null;
    graceUntil: Date | null;
    version: number;
  }): Credential =>
    Credential.reconstitute(id(r.id), {
      principalRef: r.principalRef,
      kind: r.kind as CredentialKind,
      fingerprint: r.fingerprint,
      kmsKeyRef: r.kmsKeyRef,
      status: r.status as CredentialStatus,
      supersedesRef: r.supersedesRef,
      issuedAt: r.issuedAt,
      expiresAt: r.expiresAt,
      rotationPolicy: rotationFrom(r.rotationPolicy),
      rotationDueAt: r.rotationDueAt,
      graceUntil: r.graceUntil,
      version: r.version,
    }),
};

// ── Session ───────────────────────────────────────────────────────────────────────────────────────
export const SessionMapper = {
  toRow: (s: Session, tenantId: string) => ({
    ...base(s.id.toString(), tenantId),
    principalRef: s.principalRef,
    status: s.status,
    externalRef: s.externalRef,
    deviceRef: s.deviceRef,
    refreshFingerprint: s.refreshFingerprint,
    refreshCount: s.refreshCount,
    riskAtLastEval: s.riskAtLastEval,
    impersonatedBy: s.impersonatedBy,
    delegationRef: s.delegationRef,
    establishedAt: s.establishedAt,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
  }),
  toUpdate: (s: Session) => ({
    status: s.status,
    refreshFingerprint: s.refreshFingerprint,
    refreshCount: s.refreshCount,
    riskAtLastEval: s.riskAtLastEval,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
  }),
  toDomain: (r: {
    id: string;
    principalRef: string;
    status: string;
    externalRef: string | null;
    deviceRef: string | null;
    refreshFingerprint: string;
    refreshCount: number;
    riskAtLastEval: number;
    impersonatedBy: string | null;
    delegationRef: string | null;
    establishedAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    version: number;
  }): Session =>
    Session.reconstitute(id(r.id), {
      principalRef: r.principalRef,
      status: r.status as SessionStatus,
      externalRef: r.externalRef,
      deviceRef: r.deviceRef,
      refreshFingerprint: r.refreshFingerprint,
      refreshCount: r.refreshCount,
      riskAtLastEval: r.riskAtLastEval,
      impersonatedBy: r.impersonatedBy,
      delegationRef: r.delegationRef,
      establishedAt: r.establishedAt,
      lastSeenAt: r.lastSeenAt,
      expiresAt: r.expiresAt,
      version: r.version,
    }),
};

// ── Device ────────────────────────────────────────────────────────────────────────────────────────
const signalsToJson = (signals: readonly DeviceSignal[]): Prisma.InputJsonValue =>
  json(signals.map((sg) => ({ type: sg.type, severity: sg.severity, at: sg.at.toISOString() })));
const signalsFrom = (v: unknown): DeviceSignal[] =>
  Array.isArray(v)
    ? (v as { type: string; severity: DeviceSignal["severity"]; at: string }[]).map((sg) => ({
        type: sg.type,
        severity: sg.severity,
        at: new Date(sg.at),
      }))
    : [];
export const DeviceMapper = {
  toRow: (d: Device, tenantId: string) => ({
    ...base(d.id.toString(), tenantId),
    fingerprint: d.fingerprint,
    principalRef: d.principalRef,
    tenantRef: d.tenantRef,
    trustLevel: d.trustLevel,
    reputation: d.reputation,
    metadata: { ...d.metadata },
    signals: signalsToJson(d.signals),
    anomalyCount: d.anomalyCount,
    firstSeenAt: d.firstSeenAt,
    lastSeenAt: d.lastSeenAt,
  }),
  toUpdate: (d: Device) => ({
    principalRef: d.principalRef,
    trustLevel: d.trustLevel,
    reputation: d.reputation,
    metadata: { ...d.metadata },
    signals: signalsToJson(d.signals),
    anomalyCount: d.anomalyCount,
    lastSeenAt: d.lastSeenAt,
  }),
  toDomain: (r: {
    id: string;
    fingerprint: string;
    principalRef: string | null;
    tenantRef: string | null;
    trustLevel: string;
    reputation: number;
    metadata: unknown;
    signals: unknown;
    anomalyCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    version: number;
  }): Device =>
    Device.reconstitute(id(r.id), {
      fingerprint: r.fingerprint,
      principalRef: r.principalRef,
      tenantRef: r.tenantRef,
      trustLevel: r.trustLevel as DeviceTrustLevel,
      reputation: r.reputation,
      metadata: rec(r.metadata),
      signals: signalsFrom(r.signals),
      anomalyCount: r.anomalyCount,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      version: r.version,
    }),
};

// ── MFA enrollment ────────────────────────────────────────────────────────────────────────────────
export const MfaEnrollmentMapper = {
  toRow: (m: MfaEnrollment, tenantId: string) => ({
    ...base(m.id.toString(), tenantId),
    principalRef: m.principalRef,
    method: m.method,
    status: m.status,
    secretRef: m.secretRef,
    backupCodeHashes: [...m.backupCodeHashes],
    deviceRef: m.deviceRef,
    activatedAt: m.activatedAt,
    createdAtDomain: m.createdAt,
  }),
  toUpdate: (m: MfaEnrollment) => ({
    status: m.status,
    backupCodeHashes: [...m.backupCodeHashes],
    activatedAt: m.activatedAt,
  }),
  toDomain: (r: {
    id: string;
    principalRef: string;
    method: string;
    status: string;
    secretRef: string | null;
    backupCodeHashes: unknown;
    deviceRef: string | null;
    activatedAt: Date | null;
    createdAtDomain: Date;
    version: number;
  }): MfaEnrollment =>
    MfaEnrollment.reconstitute(id(r.id), {
      principalRef: r.principalRef,
      method: r.method as MfaMethodKind,
      status: r.status as MfaEnrollmentStatus,
      secretRef: r.secretRef,
      backupCodeHashes: strArr(r.backupCodeHashes),
      deviceRef: r.deviceRef,
      createdAt: r.createdAtDomain,
      activatedAt: r.activatedAt,
      version: r.version,
    }),
};

// ── Role + assignment + relation ────────────────────────────────────────────────────────────────
export const RoleMapper = {
  toRow: (r: Role, tenantId: string) => ({
    ...base(r.id.toString(), tenantId),
    key: r.key,
    name: r.name,
    scope: scopeToJson(r.scope),
    permissions: [...r.permissions],
    parentKey: r.parentKey,
    isTemplate: r.isTemplate,
    status: r.status,
  }),
  toUpdate: (r: Role) => ({
    name: r.name,
    scope: scopeToJson(r.scope),
    permissions: [...r.permissions],
    parentKey: r.parentKey,
    status: r.status,
  }),
  toDomain: (r: {
    id: string;
    key: string;
    name: string;
    scope: unknown;
    permissions: unknown;
    parentKey: string | null;
    isTemplate: boolean;
    status: string;
    version: number;
  }): Role =>
    Role.reconstitute(id(r.id), {
      key: r.key,
      name: r.name,
      scope: scope(r.scope),
      permissions: strArr(r.permissions),
      parentKey: r.parentKey,
      isTemplate: r.isTemplate,
      status: r.status as RoleStatus,
      version: r.version,
    }),
};
const scopeToJson = (s: SecurityScope): Prisma.InputJsonValue =>
  json({
    ...(s.organization !== undefined ? { organization: s.organization } : {}),
    ...(s.tenant !== undefined ? { tenant: s.tenant } : {}),
    ...(s.workspace !== undefined ? { workspace: s.workspace } : {}),
    ...(s.environment !== undefined ? { environment: s.environment } : {}),
  });

export const RoleAssignmentMapper = {
  toRow: (a: RoleAssignment, tenantId: string) => ({
    ...base(a.id.toString(), tenantId),
    principalRef: a.principalRef,
    roleKey: a.roleKey,
    scope: scopeToJson(a.scope),
    grantedBy: a.grantedBy,
    status: a.status,
    expiresAt: a.expiresAt,
    reason: a.reason,
    grantedAt: a.grantedAt,
  }),
  toUpdate: (a: RoleAssignment) => ({ status: a.status, scope: scopeToJson(a.scope) }),
  toDomain: (r: {
    id: string;
    principalRef: string;
    roleKey: string;
    scope: unknown;
    grantedBy: string;
    status: string;
    expiresAt: Date | null;
    reason: string | null;
    grantedAt: Date;
    version: number;
  }): RoleAssignment =>
    RoleAssignment.reconstitute(id(r.id), {
      principalRef: r.principalRef,
      roleKey: r.roleKey,
      scope: scope(r.scope),
      grantedBy: r.grantedBy,
      status: r.status as AssignmentStatus,
      expiresAt: r.expiresAt,
      reason: r.reason,
      grantedAt: r.grantedAt,
      version: r.version,
    }),
};

export const RelationTupleMapper = {
  toRow: (t: RelationTuple, tenantId: string) => ({
    id: t.id,
    tenantId,
    namespace: t.namespace,
    object: t.object,
    relation: t.relation,
    subject: t.subject,
    tupleKey: t.key(),
  }),
  toDomain: (r: {
    id: string;
    namespace: string;
    object: string;
    relation: string;
    subject: string;
  }): RelationTuple =>
    new RelationTuple({
      id: r.id,
      namespace: r.namespace,
      object: r.object,
      relation: r.relation,
      subject: r.subject,
    }),
};

// ── Policy + delegation ───────────────────────────────────────────────────────────────────────────
const versionsToJson = (versions: readonly PolicyVersion[]): Prisma.InputJsonValue =>
  json(
    versions.map((v) => ({
      version: v.version,
      rules: [...v.rules],
      defaultEffect: v.defaultEffect,
      publishedAt: v.publishedAt.toISOString(),
    })),
  );
const versionsFrom = (v: unknown): PolicyVersion[] =>
  Array.isArray(v)
    ? (
        v as {
          version: number;
          rules: PolicyRule[];
          defaultEffect: PolicyEffect;
          publishedAt: string;
        }[]
      ).map(
        (pv) =>
          new PolicyVersion({
            version: pv.version,
            rules: pv.rules,
            defaultEffect: pv.defaultEffect,
            publishedAt: new Date(pv.publishedAt),
          }),
      )
    : [];
export const PolicyMapper = {
  toRow: (p: Policy, tenantId: string) => ({
    ...base(p.id.toString(), tenantId),
    key: p.key,
    name: p.name,
    mode: p.mode,
    status: p.status,
    versions: versionsToJson(p.versions),
    activeVersion: p.activeVersionNumber,
  }),
  toUpdate: (p: Policy) => ({
    name: p.name,
    mode: p.mode,
    status: p.status,
    versions: versionsToJson(p.versions),
    activeVersion: p.activeVersionNumber,
  }),
  toDomain: (r: {
    id: string;
    key: string;
    name: string;
    mode: string;
    status: string;
    versions: unknown;
    activeVersion: number | null;
    version: number;
  }): Policy =>
    Policy.reconstitute(id(r.id), {
      key: r.key,
      name: r.name,
      mode: r.mode as PolicyMode,
      status: r.status as PolicyStatus,
      versions: versionsFrom(r.versions),
      activeVersion: r.activeVersion,
      version: r.version,
    }),
};

export const DelegationMapper = {
  toRow: (d: Delegation, tenantId: string) => ({
    ...base(d.id.toString(), tenantId),
    delegatorRef: d.delegatorRef,
    delegateRef: d.delegateRef,
    scope: scopeToJson(d.scope),
    permissions: [...d.permissions],
    status: d.status,
    expiresAt: d.expiresAt,
    reason: d.reason,
    grantedAt: d.grantedAt,
  }),
  toUpdate: (d: Delegation) => ({ status: d.status }),
  toDomain: (r: {
    id: string;
    delegatorRef: string;
    delegateRef: string;
    scope: unknown;
    permissions: unknown;
    status: string;
    expiresAt: Date | null;
    reason: string | null;
    grantedAt: Date;
    version: number;
  }): Delegation =>
    Delegation.reconstitute(id(r.id), {
      delegatorRef: r.delegatorRef,
      delegateRef: r.delegateRef,
      scope: scope(r.scope),
      permissions: strArr(r.permissions),
      status: r.status as DelegationStatus,
      expiresAt: r.expiresAt,
      reason: r.reason,
      grantedAt: r.grantedAt,
      version: r.version,
    }),
};

// ── Tenant + machine + AI governance ──────────────────────────────────────────────────────────────
export const TenantProfileMapper = {
  toRow: (p: TenantSecurityProfile, tenantId: string) => ({
    ...base(p.id.toString(), tenantId),
    tenantRef: p.tenantRef,
    isolationTier: p.isolationTier,
    residencyRegion: p.residencyRegion,
    securityMode: p.securityMode,
    mfaRequired: p.mfaRequired,
    allowedAuthMethods: [...p.allowedAuthMethods],
    defaultPolicyKey: p.defaultPolicyKey,
  }),
  toUpdate: (p: TenantSecurityProfile) => ({
    isolationTier: p.isolationTier,
    residencyRegion: p.residencyRegion,
    securityMode: p.securityMode,
    mfaRequired: p.mfaRequired,
    allowedAuthMethods: [...p.allowedAuthMethods],
    defaultPolicyKey: p.defaultPolicyKey,
  }),
  toDomain: (r: {
    id: string;
    tenantRef: string;
    isolationTier: string;
    residencyRegion: string;
    securityMode: string;
    mfaRequired: boolean;
    allowedAuthMethods: unknown;
    defaultPolicyKey: string | null;
    version: number;
  }): TenantSecurityProfile =>
    TenantSecurityProfile.reconstitute(id(r.id), {
      tenantRef: r.tenantRef,
      isolationTier: r.isolationTier as IsolationTier,
      residencyRegion: r.residencyRegion,
      securityMode: r.securityMode as PolicyMode,
      mfaRequired: r.mfaRequired,
      allowedAuthMethods: strArr(r.allowedAuthMethods),
      defaultPolicyKey: r.defaultPolicyKey,
      version: r.version,
    }),
};

export const MachineIdentityMapper = {
  toRow: (m: MachineIdentityProfile, tenantId: string) => ({
    ...base(m.id.toString(), tenantId),
    principalRef: m.principalRef,
    owner: m.owner,
    purpose: m.purpose,
    allowedEnvironments: [...m.allowedEnvironments],
    maxCredentialTtlSeconds: m.maxCredentialTtlSeconds,
    rotationIntervalDays: m.rotationIntervalDays,
    allowedScopes: [...m.allowedScopes],
    status: m.status,
  }),
  toUpdate: (m: MachineIdentityProfile) => ({
    owner: m.owner,
    purpose: m.purpose,
    allowedEnvironments: [...m.allowedEnvironments],
    maxCredentialTtlSeconds: m.maxCredentialTtlSeconds,
    rotationIntervalDays: m.rotationIntervalDays,
    allowedScopes: [...m.allowedScopes],
    status: m.status,
  }),
  toDomain: (r: {
    id: string;
    principalRef: string;
    owner: string;
    purpose: string;
    allowedEnvironments: unknown;
    maxCredentialTtlSeconds: number | null;
    rotationIntervalDays: number | null;
    allowedScopes: unknown;
    status: string;
    version: number;
  }): MachineIdentityProfile =>
    MachineIdentityProfile.reconstitute(id(r.id), {
      principalRef: r.principalRef,
      owner: r.owner,
      purpose: r.purpose,
      allowedEnvironments: strArr(r.allowedEnvironments),
      maxCredentialTtlSeconds: r.maxCredentialTtlSeconds,
      rotationIntervalDays: r.rotationIntervalDays,
      allowedScopes: strArr(r.allowedScopes),
      status: r.status as MachineIdentityStatus,
      version: r.version,
    }),
};

export const AiGovernanceMapper = {
  toRow: (a: AiGovernanceProfile, tenantId: string) => ({
    ...base(a.id.toString(), tenantId),
    principalRef: a.principalRef,
    tokenBudget: a.tokenBudget,
    callQuota: a.callQuota,
    windowSeconds: a.windowSeconds,
    tokensConsumed: a.tokensConsumed,
    callsConsumed: a.callsConsumed,
    windowResetAt: a.windowResetAt,
    allowedTools: [...a.allowedTools],
    allowedResources: [...a.allowedResources],
    isolationLevel: a.isolationLevel,
    status: a.status,
  }),
  toUpdate: (a: AiGovernanceProfile) => ({
    tokenBudget: a.tokenBudget,
    callQuota: a.callQuota,
    windowSeconds: a.windowSeconds,
    tokensConsumed: a.tokensConsumed,
    callsConsumed: a.callsConsumed,
    windowResetAt: a.windowResetAt,
    allowedTools: [...a.allowedTools],
    allowedResources: [...a.allowedResources],
    isolationLevel: a.isolationLevel,
    status: a.status,
  }),
  toDomain: (r: {
    id: string;
    principalRef: string;
    tokenBudget: number | null;
    callQuota: number | null;
    windowSeconds: number;
    tokensConsumed: number;
    callsConsumed: number;
    windowResetAt: Date;
    allowedTools: unknown;
    allowedResources: unknown;
    isolationLevel: string;
    status: string;
    version: number;
  }): AiGovernanceProfile =>
    AiGovernanceProfile.reconstitute(id(r.id), {
      principalRef: r.principalRef,
      tokenBudget: r.tokenBudget,
      callQuota: r.callQuota,
      windowSeconds: r.windowSeconds,
      tokensConsumed: r.tokensConsumed,
      callsConsumed: r.callsConsumed,
      windowResetAt: r.windowResetAt,
      allowedTools: strArr(r.allowedTools),
      allowedResources: strArr(r.allowedResources),
      isolationLevel: r.isolationLevel as AiIsolationLevel,
      status: r.status as AiGovernanceStatus,
      version: r.version,
    }),
};

// ── Incident ──────────────────────────────────────────────────────────────────────────────────────
const timelineToJson = (t: readonly TimelineEntry[]): Prisma.InputJsonValue =>
  json(t.map((e) => ({ at: e.at.toISOString(), action: e.action, note: e.note })));
const timelineFrom = (v: unknown): TimelineEntry[] =>
  Array.isArray(v)
    ? (v as { at: string; action: string; note: string }[]).map((e) => ({
        at: new Date(e.at),
        action: e.action,
        note: e.note,
      }))
    : [];
const evidenceToJson = (e: readonly EvidenceEntry[]): Prisma.InputJsonValue =>
  json(e.map((x) => ({ at: x.at.toISOString(), kind: x.kind, ref: x.ref })));
const evidenceFrom = (v: unknown): EvidenceEntry[] =>
  Array.isArray(v)
    ? (v as { at: string; kind: string; ref: string }[]).map((x) => ({
        at: new Date(x.at),
        kind: x.kind,
        ref: x.ref,
      }))
    : [];
export const IncidentMapper = {
  toRow: (i: Incident, tenantId: string) => ({
    ...base(i.id.toString(), tenantId),
    reference: i.reference,
    title: i.title,
    severity: i.severity,
    status: i.status,
    category: i.category,
    tenantRef: i.tenantRef,
    assignee: i.assignee,
    resolution: i.resolution,
    timeline: timelineToJson(i.timeline),
    evidence: evidenceToJson(i.evidence),
    detectedAt: i.detectedAt,
  }),
  toUpdate: (i: Incident) => ({
    status: i.status,
    assignee: i.assignee,
    resolution: i.resolution,
    timeline: timelineToJson(i.timeline),
    evidence: evidenceToJson(i.evidence),
  }),
  toDomain: (r: {
    id: string;
    reference: string;
    title: string;
    severity: string;
    status: string;
    category: string;
    tenantRef: string | null;
    assignee: string | null;
    resolution: string | null;
    timeline: unknown;
    evidence: unknown;
    detectedAt: Date;
    version: number;
  }): Incident =>
    Incident.reconstitute(id(r.id), {
      reference: r.reference,
      title: r.title,
      severity: r.severity as IncidentSeverity,
      status: r.status as IncidentStatus,
      category: r.category,
      tenantRef: r.tenantRef,
      assignee: r.assignee,
      resolution: r.resolution,
      timeline: timelineFrom(r.timeline),
      evidence: evidenceFrom(r.evidence),
      detectedAt: r.detectedAt,
      version: r.version,
    }),
};

// ── WORM audit record (append-only; no version) ───────────────────────────────────────────────────
export const AuditRecordMapper = {
  toRow: (a: AuditRecord, tenantId: string) => ({
    id: a.id,
    tenantId,
    tenantScope: a.content.tenantRef,
    sequence: a.sequence,
    principalRef: a.content.principalRef,
    action: a.content.action,
    decision: a.content.decision,
    resource: a.content.resource,
    occurredAt: a.content.occurredAt,
    metadata: { ...a.content.metadata },
    prevHash: a.prevHash,
    hash: a.hash,
    signature: a.signature,
  }),
  toDomain: (r: {
    id: string;
    tenantScope: string | null;
    sequence: number;
    principalRef: string;
    action: string;
    decision: string;
    resource: string | null;
    occurredAt: string;
    metadata: unknown;
    prevHash: string;
    hash: string;
    signature: string | null;
  }): AuditRecord =>
    new AuditRecord({
      id: r.id,
      content: {
        sequence: r.sequence,
        principalRef: r.principalRef,
        action: r.action,
        decision: r.decision,
        resource: r.resource,
        tenantRef: r.tenantScope,
        occurredAt: r.occurredAt,
        metadata: rec(r.metadata),
        prevHash: r.prevHash,
      },
      hash: r.hash,
      signature: r.signature,
    }),
};
