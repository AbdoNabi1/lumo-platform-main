import { ScopedMap } from "./in-memory-scoped-map";
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
  private readonly byId = new ScopedMap<Principal>();
  private readonly byExternalId = new ScopedMap<Principal>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(principal: Principal, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, principal.id.toString(), principal);
    this.byExternalId.set(tenantId, principal.externalId, principal);
    await this.deps.outbox.write(
      principal.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findById(id: string, tenantId: string): Promise<Principal | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async findByExternalId(externalId: string, tenantId: string): Promise<Principal | null> {
    return this.byExternalId.get(tenantId, externalId) ?? null;
  }
  async findBySubjectRef(subjectRef: string, tenantId: string): Promise<Principal | null> {
    for (const principal of this.byId.values(tenantId)) {
      if (principal.subjectRef === subjectRef) return principal;
    }
    return null;
  }
  async listAll(tenantId: string): Promise<readonly Principal[]> {
    return this.byId.values(tenantId);
  }
}

/** In-memory `CredentialRepository` — indexes by id + principalRef. */
export class InMemoryCredentialRepository implements CredentialRepository {
  private readonly byId = new ScopedMap<Credential>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(credential: Credential, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, credential.id.toString(), credential);
    await this.deps.outbox.write(
      credential.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findById(id: string, tenantId: string): Promise<Credential | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async listByPrincipal(principalRef: string, tenantId: string): Promise<readonly Credential[]> {
    return this.byId.values(tenantId).filter((c) => c.principalRef === principalRef);
  }
  async listDueForRotation(now: Date, tenantId: string): Promise<readonly Credential[]> {
    return this.byId.values(tenantId).filter((c) => c.isDueForRotation(now));
  }
  async listAll(tenantId: string): Promise<readonly Credential[]> {
    return this.byId.values(tenantId);
  }
}

/** In-memory `SessionRepository`. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new ScopedMap<Session>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(session: Session, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, session.id.toString(), session);
    await this.deps.outbox.write(
      session.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findById(id: string, tenantId: string): Promise<Session | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async findByExternalRef(externalRef: string, tenantId: string): Promise<Session | null> {
    let latest: Session | null = null;
    for (const session of this.byId.values(tenantId)) {
      if (session.externalRef !== externalRef) continue;
      if (latest === null || session.establishedAt.getTime() > latest.establishedAt.getTime())
        latest = session;
    }
    return latest;
  }
  async listByPrincipal(principalRef: string, tenantId: string): Promise<readonly Session[]> {
    return this.byId.values(tenantId).filter((s) => s.principalRef === principalRef);
  }
  async listAll(tenantId: string): Promise<readonly Session[]> {
    return this.byId.values(tenantId);
  }
}

/** In-memory `RoleRepository` — keyed by role key. */
export class InMemoryRoleRepository implements RoleRepository, RoleRegistry {
  private readonly byKey = new ScopedMap<Role>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(role: Role, tenantId: string, tx?: unknown): Promise<void> {
    this.byKey.set(tenantId, role.key, role);
    await this.deps.outbox.write(role.pullDomainEvents(), { ...this.deps.context, tenantId }, tx);
  }
  async findByKey(key: string, tenantId: string): Promise<Role | null> {
    return this.byKey.get(tenantId, key) ?? null;
  }
  async findByKeys(keys: readonly string[], tenantId: string): Promise<readonly Role[]> {
    const out: Role[] = [];
    for (const key of keys) {
      const role = this.byKey.get(tenantId, key);
      if (role !== undefined) out.push(role);
    }
    return out;
  }
  async listAll(tenantId: string): Promise<readonly Role[]> {
    return this.byKey.values(tenantId);
  }
}

/** In-memory `RoleAssignmentRepository` — indexes by id + principalRef. */
export class InMemoryRoleAssignmentRepository implements RoleAssignmentRepository {
  private readonly byId = new ScopedMap<RoleAssignment>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(assignment: RoleAssignment, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, assignment.id.toString(), assignment);
    await this.deps.outbox.write(
      assignment.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findById(id: string, tenantId: string): Promise<RoleAssignment | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async listByPrincipal(
    principalRef: string,
    tenantId: string,
  ): Promise<readonly RoleAssignment[]> {
    return this.byId.values(tenantId).filter((a) => a.principalRef === principalRef);
  }
}

/** In-memory `PolicyRepository` — keyed by policy key. */
export class InMemoryPolicyRepository implements PolicyRepository, PolicyRegistry {
  private readonly byKey = new ScopedMap<Policy>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(policy: Policy, tenantId: string, tx?: unknown): Promise<void> {
    this.byKey.set(tenantId, policy.key, policy);
    await this.deps.outbox.write(policy.pullDomainEvents(), { ...this.deps.context, tenantId }, tx);
  }
  async findByKey(key: string, tenantId: string): Promise<Policy | null> {
    return this.byKey.get(tenantId, key) ?? null;
  }
  async listAll(tenantId: string): Promise<readonly Policy[]> {
    return this.byKey.values(tenantId);
  }
}

/** In-memory `DelegationRepository` — indexes by id + delegateRef. */
export class InMemoryDelegationRepository implements DelegationRepository {
  private readonly byId = new ScopedMap<Delegation>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(delegation: Delegation, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, delegation.id.toString(), delegation);
    await this.deps.outbox.write(
      delegation.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findById(id: string, tenantId: string): Promise<Delegation | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async listByDelegate(delegateRef: string, tenantId: string): Promise<readonly Delegation[]> {
    return this.byId.values(tenantId).filter((d) => d.delegateRef === delegateRef);
  }
}

/** In-memory `TenantSecurityProfileRepository` — keyed by tenantRef. */
export class InMemoryTenantSecurityProfileRepository implements TenantSecurityProfileRepository {
  private readonly byTenant = new ScopedMap<TenantSecurityProfile>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(profile: TenantSecurityProfile, tenantId: string, tx?: unknown): Promise<void> {
    this.byTenant.set(tenantId, profile.tenantRef, profile);
    await this.deps.outbox.write(
      profile.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findByTenant(tenantRef: string, tenantId: string): Promise<TenantSecurityProfile | null> {
    return this.byTenant.get(tenantId, tenantRef) ?? null;
  }
}

/** In-memory `DeviceRepository` — indexes by id + fingerprint; enumerable for the device explorer. */
export class InMemoryDeviceRepository implements DeviceRepository, DeviceDirectory {
  private readonly byId = new ScopedMap<Device>();
  private readonly byFingerprint = new ScopedMap<Device>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(device: Device, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, device.id.toString(), device);
    this.byFingerprint.set(tenantId, device.fingerprint, device);
    await this.deps.outbox.write(device.pullDomainEvents(), { ...this.deps.context, tenantId }, tx);
  }
  async findById(id: string, tenantId: string): Promise<Device | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async findByFingerprint(fingerprint: string, tenantId: string): Promise<Device | null> {
    return this.byFingerprint.get(tenantId, fingerprint) ?? null;
  }
  async listByPrincipal(principalRef: string, tenantId: string): Promise<readonly Device[]> {
    return this.byId.values(tenantId).filter((d) => d.principalRef === principalRef);
  }
  async listAll(tenantId: string): Promise<readonly Device[]> {
    return this.byId.values(tenantId);
  }
}

/** In-memory `MfaEnrollmentRepository` — indexes by id + principalRef. */
export class InMemoryMfaEnrollmentRepository implements MfaEnrollmentRepository {
  private readonly byId = new ScopedMap<MfaEnrollment>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(enrollment: MfaEnrollment, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, enrollment.id.toString(), enrollment);
    await this.deps.outbox.write(
      enrollment.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findById(id: string, tenantId: string): Promise<MfaEnrollment | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async listByPrincipal(principalRef: string, tenantId: string): Promise<readonly MfaEnrollment[]> {
    return this.byId.values(tenantId).filter((e) => e.principalRef === principalRef);
  }
}

/** In-memory `MachineIdentityProfileRepository` — keyed by principalRef; enumerable for the explorer. */
export class InMemoryMachineIdentityProfileRepository implements MachineIdentityProfileRepository {
  private readonly byPrincipal = new ScopedMap<MachineIdentityProfile>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(profile: MachineIdentityProfile, tenantId: string, tx?: unknown): Promise<void> {
    this.byPrincipal.set(tenantId, profile.principalRef, profile);
    await this.deps.outbox.write(
      profile.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findByPrincipal(
    principalRef: string,
    tenantId: string,
  ): Promise<MachineIdentityProfile | null> {
    return this.byPrincipal.get(tenantId, principalRef) ?? null;
  }
  async listAll(tenantId: string): Promise<readonly MachineIdentityProfile[]> {
    return this.byPrincipal.values(tenantId);
  }
}

/**
 * In-memory `RelationTupleRepository` (ReBAC) — keyed by tuple key. Tuples are relationship data (not
 * aggregates); their `security.relation.*` events are emitted by the use-case, so no outbox here.
 */
export class InMemoryRelationTupleRepository implements RelationTupleRepository {
  private readonly byKey = new ScopedMap<RelationTuple>();

  async put(tuple: RelationTuple, tenantId: string): Promise<void> {
    this.byKey.set(tenantId, tuple.key(), tuple);
  }
  async remove(key: string, tenantId: string): Promise<boolean> {
    return this.byKey.delete(tenantId, key);
  }
  async listAll(tenantId: string): Promise<readonly RelationTuple[]> {
    return this.byKey.values(tenantId);
  }
}

/** In-memory `AiGovernanceProfileRepository` — keyed by principalRef; enumerable for the AI explorer. */
export class InMemoryAiGovernanceProfileRepository implements AiGovernanceProfileRepository {
  private readonly byPrincipal = new ScopedMap<AiGovernanceProfile>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(profile: AiGovernanceProfile, tenantId: string, tx?: unknown): Promise<void> {
    this.byPrincipal.set(tenantId, profile.principalRef, profile);
    await this.deps.outbox.write(
      profile.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findByPrincipal(
    principalRef: string,
    tenantId: string,
  ): Promise<AiGovernanceProfile | null> {
    return this.byPrincipal.get(tenantId, principalRef) ?? null;
  }
  async listAll(tenantId: string): Promise<readonly AiGovernanceProfile[]> {
    return this.byPrincipal.values(tenantId);
  }
}

/** In-memory `IncidentRepository` — indexes by id + reference; enumerable for the SOC / Trust Center. */
export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly byId = new ScopedMap<Incident>();
  private readonly byReference = new ScopedMap<Incident>();
  constructor(private readonly deps: InMemorySecurityRepositoryDeps) {}

  async save(incident: Incident, tenantId: string, tx?: unknown): Promise<void> {
    this.byId.set(tenantId, incident.id.toString(), incident);
    this.byReference.set(tenantId, incident.reference, incident);
    await this.deps.outbox.write(
      incident.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }
  async findById(id: string, tenantId: string): Promise<Incident | null> {
    return this.byId.get(tenantId, id) ?? null;
  }
  async findByReference(reference: string, tenantId: string): Promise<Incident | null> {
    return this.byReference.get(tenantId, reference) ?? null;
  }
  async listAll(tenantId: string): Promise<readonly Incident[]> {
    return this.byId.values(tenantId);
  }
}

/**
 * In-memory **WORM audit ledger** — append + read only, bucketed by tenant scope, preserving
 * sequence order. Enforces the WORM contract in-process (no update/delete API surface); the durable
 * hash-chained store is deferred (gap G-SEC-1).
 */
export class InMemoryAuditLedgerRepository implements AuditLedgerRepository {
  private readonly byTenant = new ScopedMap<AuditRecord[]>();

  /** `tenantId` is the row scope (ADR-0014); `tenantRef` (null ⇒ platform chain) is the chain's own scope. */
  private bucket(tenantId: string, tenantRef: string | null): AuditRecord[] {
    const key = tenantRef ?? "__platform__";
    let list = this.byTenant.get(tenantId, key);
    if (list === undefined) {
      list = [];
      this.byTenant.set(tenantId, key, list);
    }
    return list;
  }

  async append(record: AuditRecord, tenantId: string): Promise<void> {
    this.bucket(tenantId, record.content.tenantRef).push(record);
  }
  async tail(tenantRef: string | null, tenantId: string): Promise<AuditRecord | null> {
    const list = this.bucket(tenantId, tenantRef);
    return list.length === 0 ? null : (list[list.length - 1] ?? null);
  }
  async list(tenantRef: string | null, tenantId: string): Promise<readonly AuditRecord[]> {
    return [...this.bucket(tenantId, tenantRef)];
  }
}
