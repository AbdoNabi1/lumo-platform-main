import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { AuditRecord } from "../domain/audit-record";
import type { Credential } from "../domain/credential";
import type { Delegation } from "../domain/delegation";
import type { AiGovernanceProfile } from "../domain/ai-governance-profile";
import type { Device } from "../domain/device";
import type { Incident } from "../domain/incident";
import type { MachineIdentityProfile } from "../domain/machine-identity-profile";
import type { MfaEnrollment } from "../domain/mfa-enrollment";
import type { RelationTuple } from "../domain/relationship";
import type { Policy } from "../domain/policy";
import type { Principal } from "../domain/principal";
import type {
  AiGovernanceProfileRepository,
  AuditLedgerRepository,
  CredentialRepository,
  DelegationRepository,
  DeviceDirectory,
  DeviceRepository,
  IncidentRepository,
  MachineIdentityProfileRepository,
  MfaEnrollmentRepository,
  PolicyRegistry,
  PolicyRepository,
  PrincipalDirectory,
  PrincipalRepository,
  RelationTupleRepository,
  RoleAssignmentRepository,
  RoleRegistry,
  RoleRepository,
  SessionRepository,
  TenantSecurityProfileRepository,
} from "../domain/repositories";
import type { Role } from "../domain/role";
import type { RoleAssignment } from "../domain/role-assignment";
import type { Session } from "../domain/session";
import type { TenantSecurityProfile } from "../domain/tenant-security-profile";

export interface InMemorySecurityRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `PrincipalRepository` — indexes by id + externalId; writes events to the outbox on save. */
export class InMemoryPrincipalRepository implements PrincipalRepository, PrincipalDirectory {
  private readonly byId = new Map<string, Principal>();
  private readonly byExternalId = new Map<string, Principal>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(principal: Principal, tx?: unknown): Promise<void> {
    this.byId.set(principal.id.toString(), principal);
    this.byExternalId.set(principal.externalId, principal);
    await this.deps.outbox.write(principal.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<Principal | null> {
    return this.byId.get(id) ?? null;
  }
  async findByExternalId(externalId: string): Promise<Principal | null> {
    return this.byExternalId.get(externalId) ?? null;
  }
  async findBySubjectRef(subjectRef: string): Promise<Principal | null> {
    for (const principal of this.byId.values()) {
      if (principal.subjectRef === subjectRef) return principal;
    }
    return null;
  }
  async listAll(): Promise<readonly Principal[]> {
    return [...this.byId.values()];
  }
}

/** In-memory `CredentialRepository` — indexes by id + principalRef. */
export class InMemoryCredentialRepository implements CredentialRepository {
  private readonly byId = new Map<string, Credential>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(credential: Credential, tx?: unknown): Promise<void> {
    this.byId.set(credential.id.toString(), credential);
    await this.deps.outbox.write(credential.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<Credential | null> {
    return this.byId.get(id) ?? null;
  }
  async listByPrincipal(principalRef: string): Promise<readonly Credential[]> {
    return [...this.byId.values()].filter((c) => c.principalRef === principalRef);
  }
  async listDueForRotation(now: Date): Promise<readonly Credential[]> {
    return [...this.byId.values()].filter((c) => c.isDueForRotation(now));
  }
  async listAll(): Promise<readonly Credential[]> {
    return [...this.byId.values()];
  }
}

/** In-memory `SessionRepository`. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, Session>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(session: Session, tx?: unknown): Promise<void> {
    this.byId.set(session.id.toString(), session);
    await this.deps.outbox.write(session.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<Session | null> {
    return this.byId.get(id) ?? null;
  }
  async findByExternalRef(externalRef: string): Promise<Session | null> {
    let latest: Session | null = null;
    for (const session of this.byId.values()) {
      if (session.externalRef !== externalRef) continue;
      if (latest === null || session.establishedAt.getTime() > latest.establishedAt.getTime())
        latest = session;
    }
    return latest;
  }
  async listByPrincipal(principalRef: string): Promise<readonly Session[]> {
    return [...this.byId.values()].filter((s) => s.principalRef === principalRef);
  }
  async listAll(): Promise<readonly Session[]> {
    return [...this.byId.values()];
  }
}

/** In-memory `RoleRepository` — keyed by role key. */
export class InMemoryRoleRepository implements RoleRepository, RoleRegistry {
  private readonly byKey = new Map<string, Role>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(role: Role, tx?: unknown): Promise<void> {
    this.byKey.set(role.key, role);
    await this.deps.outbox.write(role.pullDomainEvents(), this.deps.context, tx);
  }
  async findByKey(key: string): Promise<Role | null> {
    return this.byKey.get(key) ?? null;
  }
  async findByKeys(keys: readonly string[]): Promise<readonly Role[]> {
    const out: Role[] = [];
    for (const key of keys) {
      const role = this.byKey.get(key);
      if (role !== undefined) out.push(role);
    }
    return out;
  }
  async listAll(): Promise<readonly Role[]> {
    return [...this.byKey.values()];
  }
}

/** In-memory `RoleAssignmentRepository` — indexes by id + principalRef. */
export class InMemoryRoleAssignmentRepository implements RoleAssignmentRepository {
  private readonly byId = new Map<string, RoleAssignment>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(assignment: RoleAssignment, tx?: unknown): Promise<void> {
    this.byId.set(assignment.id.toString(), assignment);
    await this.deps.outbox.write(assignment.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<RoleAssignment | null> {
    return this.byId.get(id) ?? null;
  }
  async listByPrincipal(principalRef: string): Promise<readonly RoleAssignment[]> {
    return [...this.byId.values()].filter((a) => a.principalRef === principalRef);
  }
}

/** In-memory `PolicyRepository` — keyed by policy key. */
export class InMemoryPolicyRepository implements PolicyRepository, PolicyRegistry {
  private readonly byKey = new Map<string, Policy>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(policy: Policy, tx?: unknown): Promise<void> {
    this.byKey.set(policy.key, policy);
    await this.deps.outbox.write(policy.pullDomainEvents(), this.deps.context, tx);
  }
  async findByKey(key: string): Promise<Policy | null> {
    return this.byKey.get(key) ?? null;
  }
  async listAll(): Promise<readonly Policy[]> {
    return [...this.byKey.values()];
  }
}

/** In-memory `DelegationRepository` — indexes by id + delegateRef. */
export class InMemoryDelegationRepository implements DelegationRepository {
  private readonly byId = new Map<string, Delegation>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(delegation: Delegation, tx?: unknown): Promise<void> {
    this.byId.set(delegation.id.toString(), delegation);
    await this.deps.outbox.write(delegation.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<Delegation | null> {
    return this.byId.get(id) ?? null;
  }
  async listByDelegate(delegateRef: string): Promise<readonly Delegation[]> {
    return [...this.byId.values()].filter((d) => d.delegateRef === delegateRef);
  }
}

/** In-memory `TenantSecurityProfileRepository` — keyed by tenantRef. */
export class InMemoryTenantSecurityProfileRepository implements TenantSecurityProfileRepository {
  private readonly byTenant = new Map<string, TenantSecurityProfile>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(profile: TenantSecurityProfile, tx?: unknown): Promise<void> {
    this.byTenant.set(profile.tenantRef, profile);
    await this.deps.outbox.write(profile.pullDomainEvents(), this.deps.context, tx);
  }
  async findByTenant(tenantRef: string): Promise<TenantSecurityProfile | null> {
    return this.byTenant.get(tenantRef) ?? null;
  }
}

/** In-memory `DeviceRepository` — indexes by id + fingerprint; enumerable for the device explorer. */
export class InMemoryDeviceRepository implements DeviceRepository, DeviceDirectory {
  private readonly byId = new Map<string, Device>();
  private readonly byFingerprint = new Map<string, Device>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(device: Device, tx?: unknown): Promise<void> {
    this.byId.set(device.id.toString(), device);
    this.byFingerprint.set(device.fingerprint, device);
    await this.deps.outbox.write(device.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<Device | null> {
    return this.byId.get(id) ?? null;
  }
  async findByFingerprint(fingerprint: string): Promise<Device | null> {
    return this.byFingerprint.get(fingerprint) ?? null;
  }
  async listByPrincipal(principalRef: string): Promise<readonly Device[]> {
    return [...this.byId.values()].filter((d) => d.principalRef === principalRef);
  }
  async listAll(): Promise<readonly Device[]> {
    return [...this.byId.values()];
  }
}

/** In-memory `MfaEnrollmentRepository` — indexes by id + principalRef. */
export class InMemoryMfaEnrollmentRepository implements MfaEnrollmentRepository {
  private readonly byId = new Map<string, MfaEnrollment>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(enrollment: MfaEnrollment, tx?: unknown): Promise<void> {
    this.byId.set(enrollment.id.toString(), enrollment);
    await this.deps.outbox.write(enrollment.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<MfaEnrollment | null> {
    return this.byId.get(id) ?? null;
  }
  async listByPrincipal(principalRef: string): Promise<readonly MfaEnrollment[]> {
    return [...this.byId.values()].filter((e) => e.principalRef === principalRef);
  }
}

/** In-memory `MachineIdentityProfileRepository` — keyed by principalRef; enumerable for the explorer. */
export class InMemoryMachineIdentityProfileRepository implements MachineIdentityProfileRepository {
  private readonly byPrincipal = new Map<string, MachineIdentityProfile>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(profile: MachineIdentityProfile, tx?: unknown): Promise<void> {
    this.byPrincipal.set(profile.principalRef, profile);
    await this.deps.outbox.write(profile.pullDomainEvents(), this.deps.context, tx);
  }
  async findByPrincipal(principalRef: string): Promise<MachineIdentityProfile | null> {
    return this.byPrincipal.get(principalRef) ?? null;
  }
  async listAll(): Promise<readonly MachineIdentityProfile[]> {
    return [...this.byPrincipal.values()];
  }
}

/**
 * In-memory `RelationTupleRepository` (ReBAC) — keyed by tuple key. Tuples are relationship data (not
 * aggregates); their `security.relation.*` events are emitted by the use-case, so no outbox here.
 */
export class InMemoryRelationTupleRepository implements RelationTupleRepository {
  private readonly byKey = new Map<string, RelationTuple>();

  async put(tuple: RelationTuple): Promise<void> {
    this.byKey.set(tuple.key(), tuple);
  }
  async remove(key: string): Promise<boolean> {
    return this.byKey.delete(key);
  }
  async listAll(): Promise<readonly RelationTuple[]> {
    return [...this.byKey.values()];
  }
}

/** In-memory `AiGovernanceProfileRepository` — keyed by principalRef; enumerable for the AI explorer. */
export class InMemoryAiGovernanceProfileRepository implements AiGovernanceProfileRepository {
  private readonly byPrincipal = new Map<string, AiGovernanceProfile>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(profile: AiGovernanceProfile, tx?: unknown): Promise<void> {
    this.byPrincipal.set(profile.principalRef, profile);
    await this.deps.outbox.write(profile.pullDomainEvents(), this.deps.context, tx);
  }
  async findByPrincipal(principalRef: string): Promise<AiGovernanceProfile | null> {
    return this.byPrincipal.get(principalRef) ?? null;
  }
  async listAll(): Promise<readonly AiGovernanceProfile[]> {
    return [...this.byPrincipal.values()];
  }
}

/** In-memory `IncidentRepository` — indexes by id + reference; enumerable for the SOC / Trust Center. */
export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly byId = new Map<string, Incident>();
  private readonly byReference = new Map<string, Incident>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(incident: Incident, tx?: unknown): Promise<void> {
    this.byId.set(incident.id.toString(), incident);
    this.byReference.set(incident.reference, incident);
    await this.deps.outbox.write(incident.pullDomainEvents(), this.deps.context, tx);
  }
  async findById(id: string): Promise<Incident | null> {
    return this.byId.get(id) ?? null;
  }
  async findByReference(reference: string): Promise<Incident | null> {
    return this.byReference.get(reference) ?? null;
  }
  async listAll(): Promise<readonly Incident[]> {
    return [...this.byId.values()];
  }
}

/**
 * In-memory **WORM audit ledger** — append + read only, bucketed by tenant scope, preserving
 * sequence order. Enforces the WORM contract in-process (no update/delete API surface); the durable
 * hash-chained store is deferred (gap G-SEC-1).
 */
export class InMemoryAuditLedgerRepository implements AuditLedgerRepository {
  private readonly byTenant = new Map<string, AuditRecord[]>();

  private bucket(tenantRef: string | null): AuditRecord[] {
    const key = tenantRef ?? "__platform__";
    let list = this.byTenant.get(key);
    if (list === undefined) {
      list = [];
      this.byTenant.set(key, list);
    }
    return list;
  }

  async append(record: AuditRecord): Promise<void> {
    this.bucket(record.content.tenantRef).push(record);
  }
  async tail(tenantRef: string | null): Promise<AuditRecord | null> {
    const list = this.bucket(tenantRef);
    return list.length === 0 ? null : (list[list.length - 1] ?? null);
  }
  async list(tenantRef: string | null): Promise<readonly AuditRecord[]> {
    return [...this.bucket(tenantRef)];
  }
}
