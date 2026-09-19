import type { AuditRecord } from "./audit-record";
import type { Credential } from "./credential";
import type { Delegation } from "./delegation";
import type { AiGovernanceProfile } from "./ai-governance-profile";
import type { Device } from "./device";
import type { Incident } from "./incident";
import type { MachineIdentityProfile } from "./machine-identity-profile";
import type { MfaEnrollment } from "./mfa-enrollment";
import type { Policy } from "./policy";
import type { RelationTuple } from "./relationship";
import type { Principal } from "./principal";
import type { Role } from "./role";
import type { RoleAssignment } from "./role-assignment";
import type { Session } from "./session";
import type { TenantSecurityProfile } from "./tenant-security-profile";

/** Persists principals (keyed by id + externalId). Optimistic-locked, same-tx outbox. */
export interface PrincipalRepository {
  save(principal: Principal, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Principal | null>;
  findByExternalId(externalId: string, tenantId: string, tx?: unknown): Promise<Principal | null>;
  /** Resolves a human principal by its Identity `subjectRef` (the shared identity id) — H-2 resolution. */
  findBySubjectRef(subjectRef: string, tenantId: string, tx?: unknown): Promise<Principal | null>;
}

export interface CredentialRepository {
  save(credential: Credential, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Credential | null>;
  listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Credential[]>;
  /** Active credentials whose scheduled rotation is due at/before `now` (secret rotation §7). */
  listDueForRotation(now: Date, tenantId: string, tx?: unknown): Promise<readonly Credential[]>;
  /** All credentials — the secret explorer read model (§17). Never exposes secret values. */
  listAll(tenantId: string, tx?: unknown): Promise<readonly Credential[]>;
}

export interface SessionRepository {
  save(session: Session, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Session | null>;
  /**
   * Resolves the session mirroring an upstream identity-provider session id (Kratos/OIDC `sid`) —
   * the federation lookup (ADR-0031). Returns the most recently established match so a re-login
   * that reuses an upstream id never resolves a stale revoked mirror.
   */
  findByExternalRef(externalRef: string, tenantId: string, tx?: unknown): Promise<Session | null>;
  listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Session[]>;
  /** All sessions — session intelligence + analytics read models (§5). */
  listAll(tenantId: string, tx?: unknown): Promise<readonly Session[]>;
}

export interface RoleRepository {
  save(role: Role, tenantId: string, tx?: unknown): Promise<void>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<Role | null>;
  /** Loads a set of roles by key (used to resolve inheritance during authorization). */
  findByKeys(keys: readonly string[], tenantId: string, tx?: unknown): Promise<readonly Role[]>;
}

export interface RoleAssignmentRepository {
  save(assignment: RoleAssignment, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<RoleAssignment | null>;
  listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly RoleAssignment[]>;
}

export interface PolicyRepository {
  save(policy: Policy, tenantId: string, tx?: unknown): Promise<void>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<Policy | null>;
}

export interface DelegationRepository {
  save(delegation: Delegation, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Delegation | null>;
  listByDelegate(
    delegateRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Delegation[]>;
}

export interface TenantSecurityProfileRepository {
  save(profile: TenantSecurityProfile, tenantId: string, tx?: unknown): Promise<void>;
  findByTenant(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<TenantSecurityProfile | null>;
}

/** Persists devices (keyed by id + fingerprint). Same-tx outbox (P2.0-B §3). */
export interface DeviceRepository {
  save(device: Device, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Device | null>;
  findByFingerprint(fingerprint: string, tenantId: string, tx?: unknown): Promise<Device | null>;
  listByPrincipal(principalRef: string, tenantId: string, tx?: unknown): Promise<readonly Device[]>;
}

/** Persists MFA enrollments (keyed by id; indexed by principal). Same-tx outbox (P2.0-B §2). */
export interface MfaEnrollmentRepository {
  save(enrollment: MfaEnrollment, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<MfaEnrollment | null>;
  listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly MfaEnrollment[]>;
}

/** Persists machine-identity governance profiles (keyed by principalRef). Same-tx outbox (P2.0-C §14). */
export interface MachineIdentityProfileRepository {
  save(profile: MachineIdentityProfile, tenantId: string, tx?: unknown): Promise<void>;
  findByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MachineIdentityProfile | null>;
  listAll(tenantId: string, tx?: unknown): Promise<readonly MachineIdentityProfile[]>;
}

/** Persists ReBAC relation tuples (keyed by tuple key). Append/remove; enumerable for evaluation (§16). */
export interface RelationTupleRepository {
  put(tuple: RelationTuple, tenantId: string, tx?: unknown): Promise<void>;
  remove(key: string, tenantId: string, tx?: unknown): Promise<boolean>;
  listAll(tenantId: string, tx?: unknown): Promise<readonly RelationTuple[]>;
}

/** Persists AI governance profiles (keyed by principalRef; enumerable for the explorer) — §20. */
export interface AiGovernanceProfileRepository {
  save(profile: AiGovernanceProfile, tenantId: string, tx?: unknown): Promise<void>;
  findByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<AiGovernanceProfile | null>;
  listAll(tenantId: string, tx?: unknown): Promise<readonly AiGovernanceProfile[]>;
}

/** Persists security incidents (keyed by id + reference; enumerable for SOC/Trust Center) — §11. */
export interface IncidentRepository {
  save(incident: Incident, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Incident | null>;
  findByReference(reference: string, tenantId: string, tx?: unknown): Promise<Incident | null>;
  listAll(tenantId: string, tx?: unknown): Promise<readonly Incident[]>;
}

/**
 * Read-side directories for the Platform Console (Part 10) — enumeration for read models only.
 * In-memory returns everything; the production adapter pages. Kept separate from the write
 * repositories so command paths stay narrow.
 */
export interface PrincipalDirectory {
  listAll(tenantId: string, tx?: unknown): Promise<readonly Principal[]>;
}
export interface RoleRegistry {
  listAll(tenantId: string, tx?: unknown): Promise<readonly Role[]>;
}
export interface PolicyRegistry {
  listAll(tenantId: string, tx?: unknown): Promise<readonly Policy[]>;
}
export interface DeviceDirectory {
  listAll(tenantId: string, tx?: unknown): Promise<readonly Device[]>;
}

/**
 * The **WORM audit ledger** — append + read only (never update/delete). `tail` returns the latest
 * record so the {@link AuditChain} can link the next one; `list` returns records in sequence order
 * for verification and the audit timeline read model (ADR-0009, ADR-0023 Part 4).
 */
export interface AuditLedgerRepository {
  append(record: AuditRecord, tenantId: string, tx?: unknown): Promise<void>;
  tail(tenantRef: string | null, tenantId: string, tx?: unknown): Promise<AuditRecord | null>;
  list(tenantRef: string | null, tenantId: string, tx?: unknown): Promise<readonly AuditRecord[]>;
}
