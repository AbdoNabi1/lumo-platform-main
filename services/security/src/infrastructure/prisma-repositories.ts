import type { DomainEvent } from "@platform/domain";
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { AuditRecord } from "../domain/audit-record";
import type { Credential } from "../domain/credential";
import type { Delegation } from "../domain/delegation";
import type { Device } from "../domain/device";
import type { Incident } from "../domain/incident";
import type { AiGovernanceProfile } from "../domain/ai-governance-profile";
import type { MachineIdentityProfile } from "../domain/machine-identity-profile";
import type { MfaEnrollment } from "../domain/mfa-enrollment";
import type { Policy } from "../domain/policy";
import type { Principal } from "../domain/principal";
import type { RelationTuple } from "../domain/relationship";
import type { Role } from "../domain/role";
import type { RoleAssignment } from "../domain/role-assignment";
import type { Session } from "../domain/session";
import type { TenantSecurityProfile } from "../domain/tenant-security-profile";
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
import * as M from "./prisma-mappers";

export interface PrismaSecurityRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

function requireTx(tx: unknown): TransactionClient {
  if (tx === undefined || tx === null)
    throw new Error(
      "Security repository.save requires the unit of work's transaction client (ADR-0003).",
    );
  return tx as TransactionClient;
}

/**
 * Persists a versioned aggregate with optimistic concurrency + same-tx outbox. `version === 0` ⇒ a
 * fresh aggregate (INSERT at DB version 1); otherwise an optimistic UPDATE guarded by the loaded
 * version (0 rows ⇒ {@link ConcurrencyError}). Centralised so the write discipline lives in one place.
 */
async function persist(opts: {
  isNew: boolean;
  version: number;
  entityLabel: string;
  create: () => Promise<unknown>;
  update: () => Promise<{ count: number }>;
  events: readonly DomainEvent[];
  deps: PrismaSecurityRepositoryDeps;
  tenantId: string;
  client: TransactionClient;
}): Promise<void> {
  if (opts.isNew) {
    await opts.create();
  } else {
    const updated = await opts.update();
    if (updated.count === 0)
      throw new ConcurrencyError(
        `${opts.entityLabel} was modified concurrently (expected version ${opts.version})`,
      );
  }
  await opts.deps.outbox.write(
    opts.events,
    { ...opts.deps.context, tenantId: opts.tenantId },
    opts.client,
  );
}

abstract class BasePrismaRepository {
  constructor(protected readonly deps: PrismaSecurityRepositoryDeps) {}
  /** ADR-0014: reuse the caller's `tx` if given, else scope the read via `runReadScoped`. */
  protected read<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }
}

// ── Principal ─────────────────────────────────────────────────────────────────────────────────────
export class PrismaPrincipalRepository
  extends BasePrismaRepository
  implements PrincipalRepository, PrincipalDirectory
{
  async save(principal: Principal, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = principal.id.toString();
    await persist({
      isNew: principal.version === 0,
      version: principal.version,
      entityLabel: `Principal ${id}`,
      create: () =>
        client.securityPrincipal.create({
          data: M.PrincipalMapper.toRow(principal, tenantId),
        }),
      update: () =>
        client.securityPrincipal.updateMany({
          where: { id, tenantId, version: principal.version },
          data: { ...M.PrincipalMapper.toUpdate(principal), version: { increment: 1 } },
        }),
      events: principal.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Principal | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityPrincipal.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.PrincipalMapper.toDomain(row);
  }
  async findByExternalId(
    externalId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Principal | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityPrincipal.findFirst({
        where: { tenantId, externalId },
      }),
    );
    return row === null ? null : M.PrincipalMapper.toDomain(row);
  }
  async findBySubjectRef(
    subjectRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Principal | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityPrincipal.findFirst({
        where: { tenantId, subjectRef },
      }),
    );
    return row === null ? null : M.PrincipalMapper.toDomain(row);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly Principal[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityPrincipal.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.PrincipalMapper.toDomain);
  }
}

// ── Credential ────────────────────────────────────────────────────────────────────────────────────
export class PrismaCredentialRepository
  extends BasePrismaRepository
  implements CredentialRepository
{
  async save(credential: Credential, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = credential.id.toString();
    await persist({
      isNew: credential.version === 0,
      version: credential.version,
      entityLabel: `Credential ${id}`,
      create: () =>
        client.securityCredential.create({
          data: M.CredentialMapper.toRow(credential, tenantId),
        }),
      update: () =>
        client.securityCredential.updateMany({
          where: { id, tenantId, version: credential.version },
          data: { ...M.CredentialMapper.toUpdate(credential), version: { increment: 1 } },
        }),
      events: credential.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Credential | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityCredential.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.CredentialMapper.toDomain(row);
  }
  async listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Credential[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityCredential.findMany({
        where: { tenantId, principalRef },
      }),
    );
    return rows.map(M.CredentialMapper.toDomain);
  }
  async listDueForRotation(
    now: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Credential[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityCredential.findMany({
        where: { tenantId, status: "active", rotationDueAt: { lte: now } },
      }),
    );
    return rows.map(M.CredentialMapper.toDomain);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly Credential[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityCredential.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.CredentialMapper.toDomain);
  }
}

// ── Session ───────────────────────────────────────────────────────────────────────────────────────
export class PrismaSessionRepository extends BasePrismaRepository implements SessionRepository {
  async save(session: Session, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = session.id.toString();
    await persist({
      isNew: session.version === 0,
      version: session.version,
      entityLabel: `Session ${id}`,
      create: () =>
        client.securitySession.create({ data: M.SessionMapper.toRow(session, tenantId) }),
      update: () =>
        client.securitySession.updateMany({
          where: { id, tenantId, version: session.version },
          data: { ...M.SessionMapper.toUpdate(session), version: { increment: 1 } },
        }),
      events: session.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Session | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securitySession.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.SessionMapper.toDomain(row);
  }
  async findByExternalRef(
    externalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Session | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securitySession.findFirst({
        where: { tenantId, externalRef },
        orderBy: { establishedAt: "desc" },
      }),
    );
    return row === null ? null : M.SessionMapper.toDomain(row);
  }
  async listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Session[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securitySession.findMany({
        where: { tenantId, principalRef },
      }),
    );
    return rows.map(M.SessionMapper.toDomain);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly Session[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securitySession.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.SessionMapper.toDomain);
  }
}

// ── Device ────────────────────────────────────────────────────────────────────────────────────────
export class PrismaDeviceRepository
  extends BasePrismaRepository
  implements DeviceRepository, DeviceDirectory
{
  async save(device: Device, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = device.id.toString();
    await persist({
      isNew: device.version === 0,
      version: device.version,
      entityLabel: `Device ${id}`,
      create: () => client.securityDevice.create({ data: M.DeviceMapper.toRow(device, tenantId) }),
      update: () =>
        client.securityDevice.updateMany({
          where: { id, tenantId, version: device.version },
          data: { ...M.DeviceMapper.toUpdate(device), version: { increment: 1 } },
        }),
      events: device.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Device | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityDevice.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.DeviceMapper.toDomain(row);
  }
  async findByFingerprint(
    fingerprint: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Device | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityDevice.findFirst({
        where: { tenantId, fingerprint },
      }),
    );
    return row === null ? null : M.DeviceMapper.toDomain(row);
  }
  async listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Device[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityDevice.findMany({
        where: { tenantId, principalRef },
      }),
    );
    return rows.map(M.DeviceMapper.toDomain);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly Device[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityDevice.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.DeviceMapper.toDomain);
  }
}

// ── MFA enrollment ────────────────────────────────────────────────────────────────────────────────
export class PrismaMfaEnrollmentRepository
  extends BasePrismaRepository
  implements MfaEnrollmentRepository
{
  async save(enrollment: MfaEnrollment, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = enrollment.id.toString();
    await persist({
      isNew: enrollment.version === 0,
      version: enrollment.version,
      entityLabel: `MfaEnrollment ${id}`,
      create: () =>
        client.securityMfaEnrollment.create({
          data: M.MfaEnrollmentMapper.toRow(enrollment, tenantId),
        }),
      update: () =>
        client.securityMfaEnrollment.updateMany({
          where: { id, tenantId, version: enrollment.version },
          data: { ...M.MfaEnrollmentMapper.toUpdate(enrollment), version: { increment: 1 } },
        }),
      events: enrollment.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<MfaEnrollment | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityMfaEnrollment.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.MfaEnrollmentMapper.toDomain(row);
  }
  async listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly MfaEnrollment[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityMfaEnrollment.findMany({
        where: { tenantId, principalRef },
      }),
    );
    return rows.map(M.MfaEnrollmentMapper.toDomain);
  }
}

// ── Role + assignment ────────────────────────────────────────────────────────────────────────────
export class PrismaRoleRepository
  extends BasePrismaRepository
  implements RoleRepository, RoleRegistry
{
  async save(role: Role, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = role.id.toString();
    await persist({
      isNew: role.version === 0,
      version: role.version,
      entityLabel: `Role ${id}`,
      create: () => client.securityRole.create({ data: M.RoleMapper.toRow(role, tenantId) }),
      update: () =>
        client.securityRole.updateMany({
          where: { id, tenantId, version: role.version },
          data: { ...M.RoleMapper.toUpdate(role), version: { increment: 1 } },
        }),
      events: role.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findByKey(key: string, tenantId: string, tx?: unknown): Promise<Role | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityRole.findFirst({
        where: { tenantId, key },
      }),
    );
    return row === null ? null : M.RoleMapper.toDomain(row);
  }
  async findByKeys(
    keys: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Role[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityRole.findMany({
        where: { tenantId, key: { in: [...keys] } },
      }),
    );
    return rows.map(M.RoleMapper.toDomain);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly Role[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityRole.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.RoleMapper.toDomain);
  }
}

export class PrismaRoleAssignmentRepository
  extends BasePrismaRepository
  implements RoleAssignmentRepository
{
  async save(assignment: RoleAssignment, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = assignment.id.toString();
    await persist({
      isNew: assignment.version === 0,
      version: assignment.version,
      entityLabel: `RoleAssignment ${id}`,
      create: () =>
        client.securityRoleAssignment.create({
          data: M.RoleAssignmentMapper.toRow(assignment, tenantId),
        }),
      update: () =>
        client.securityRoleAssignment.updateMany({
          where: { id, tenantId, version: assignment.version },
          data: { ...M.RoleAssignmentMapper.toUpdate(assignment), version: { increment: 1 } },
        }),
      events: assignment.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<RoleAssignment | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityRoleAssignment.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.RoleAssignmentMapper.toDomain(row);
  }
  async listByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly RoleAssignment[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityRoleAssignment.findMany({
        where: { tenantId, principalRef },
      }),
    );
    return rows.map(M.RoleAssignmentMapper.toDomain);
  }
}

// ── Relation tuples (ReBAC) — no version; put/remove ─────────────────────────────────────────────
export class PrismaRelationTupleRepository
  extends BasePrismaRepository
  implements RelationTupleRepository
{
  async put(tuple: RelationTuple, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const row = M.RelationTupleMapper.toRow(tuple, tenantId);
    await client.securityRelationTuple.upsert({
      where: { tenantId_tupleKey: { tenantId, tupleKey: row.tupleKey } },
      create: row,
      update: {},
    });
  }
  async remove(key: string, tenantId: string, tx?: unknown): Promise<boolean> {
    const client = requireTx(tx);
    const deleted = await client.securityRelationTuple.deleteMany({
      where: { tenantId, tupleKey: key },
    });
    return deleted.count > 0;
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly RelationTuple[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityRelationTuple.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.RelationTupleMapper.toDomain);
  }
}

// ── Policy + delegation ───────────────────────────────────────────────────────────────────────────
export class PrismaPolicyRepository
  extends BasePrismaRepository
  implements PolicyRepository, PolicyRegistry
{
  async save(policy: Policy, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = policy.id.toString();
    await persist({
      isNew: policy.version === 0,
      version: policy.version,
      entityLabel: `Policy ${id}`,
      create: () => client.securityPolicy.create({ data: M.PolicyMapper.toRow(policy, tenantId) }),
      update: () =>
        client.securityPolicy.updateMany({
          where: { id, tenantId, version: policy.version },
          data: { ...M.PolicyMapper.toUpdate(policy), version: { increment: 1 } },
        }),
      events: policy.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findByKey(key: string, tenantId: string, tx?: unknown): Promise<Policy | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityPolicy.findFirst({
        where: { tenantId, key },
      }),
    );
    return row === null ? null : M.PolicyMapper.toDomain(row);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly Policy[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityPolicy.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.PolicyMapper.toDomain);
  }
}

export class PrismaDelegationRepository
  extends BasePrismaRepository
  implements DelegationRepository
{
  async save(delegation: Delegation, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = delegation.id.toString();
    await persist({
      isNew: delegation.version === 0,
      version: delegation.version,
      entityLabel: `Delegation ${id}`,
      create: () =>
        client.securityDelegation.create({
          data: M.DelegationMapper.toRow(delegation, tenantId),
        }),
      update: () =>
        client.securityDelegation.updateMany({
          where: { id, tenantId, version: delegation.version },
          data: { ...M.DelegationMapper.toUpdate(delegation), version: { increment: 1 } },
        }),
      events: delegation.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Delegation | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityDelegation.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.DelegationMapper.toDomain(row);
  }
  async listByDelegate(
    delegateRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Delegation[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityDelegation.findMany({
        where: { tenantId, delegateRef },
      }),
    );
    return rows.map(M.DelegationMapper.toDomain);
  }
}

// ── Tenant + machine + AI governance ──────────────────────────────────────────────────────────────
export class PrismaTenantSecurityProfileRepository
  extends BasePrismaRepository
  implements TenantSecurityProfileRepository
{
  async save(profile: TenantSecurityProfile, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = profile.id.toString();
    await persist({
      isNew: profile.version === 0,
      version: profile.version,
      entityLabel: `TenantSecurityProfile ${id}`,
      create: () =>
        client.securityTenantProfile.create({
          data: M.TenantProfileMapper.toRow(profile, tenantId),
        }),
      update: () =>
        client.securityTenantProfile.updateMany({
          where: { id, tenantId, version: profile.version },
          data: { ...M.TenantProfileMapper.toUpdate(profile), version: { increment: 1 } },
        }),
      events: profile.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findByTenant(
    tenantRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<TenantSecurityProfile | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityTenantProfile.findFirst({
        where: { tenantId, tenantRef },
      }),
    );
    return row === null ? null : M.TenantProfileMapper.toDomain(row);
  }
}

export class PrismaMachineIdentityProfileRepository
  extends BasePrismaRepository
  implements MachineIdentityProfileRepository
{
  async save(profile: MachineIdentityProfile, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = profile.id.toString();
    await persist({
      isNew: profile.version === 0,
      version: profile.version,
      entityLabel: `MachineIdentityProfile ${id}`,
      create: () =>
        client.securityMachineIdentity.create({
          data: M.MachineIdentityMapper.toRow(profile, tenantId),
        }),
      update: () =>
        client.securityMachineIdentity.updateMany({
          where: { id, tenantId, version: profile.version },
          data: { ...M.MachineIdentityMapper.toUpdate(profile), version: { increment: 1 } },
        }),
      events: profile.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<MachineIdentityProfile | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityMachineIdentity.findFirst({
        where: { tenantId, principalRef },
      }),
    );
    return row === null ? null : M.MachineIdentityMapper.toDomain(row);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly MachineIdentityProfile[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityMachineIdentity.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.MachineIdentityMapper.toDomain);
  }
}

export class PrismaAiGovernanceProfileRepository
  extends BasePrismaRepository
  implements AiGovernanceProfileRepository
{
  async save(profile: AiGovernanceProfile, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = profile.id.toString();
    await persist({
      isNew: profile.version === 0,
      version: profile.version,
      entityLabel: `AiGovernanceProfile ${id}`,
      create: () =>
        client.securityAiGovernance.create({
          data: M.AiGovernanceMapper.toRow(profile, tenantId),
        }),
      update: () =>
        client.securityAiGovernance.updateMany({
          where: { id, tenantId, version: profile.version },
          data: { ...M.AiGovernanceMapper.toUpdate(profile), version: { increment: 1 } },
        }),
      events: profile.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findByPrincipal(
    principalRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<AiGovernanceProfile | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityAiGovernance.findFirst({
        where: { tenantId, principalRef },
      }),
    );
    return row === null ? null : M.AiGovernanceMapper.toDomain(row);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly AiGovernanceProfile[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityAiGovernance.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.AiGovernanceMapper.toDomain);
  }
}

// ── Incident ──────────────────────────────────────────────────────────────────────────────────────
export class PrismaIncidentRepository extends BasePrismaRepository implements IncidentRepository {
  async save(incident: Incident, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = incident.id.toString();
    await persist({
      isNew: incident.version === 0,
      version: incident.version,
      entityLabel: `Incident ${id}`,
      create: () =>
        client.securityIncident.create({
          data: M.IncidentMapper.toRow(incident, tenantId),
        }),
      update: () =>
        client.securityIncident.updateMany({
          where: { id, tenantId, version: incident.version },
          data: { ...M.IncidentMapper.toUpdate(incident), version: { increment: 1 } },
        }),
      events: incident.pullDomainEvents(),
      deps: this.deps,
      tenantId,
      client,
    });
  }
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Incident | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityIncident.findFirst({
        where: { tenantId, id },
      }),
    );
    return row === null ? null : M.IncidentMapper.toDomain(row);
  }
  async findByReference(
    reference: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Incident | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityIncident.findFirst({
        where: { tenantId, reference },
      }),
    );
    return row === null ? null : M.IncidentMapper.toDomain(row);
  }
  async listAll(tenantId: string, tx?: unknown): Promise<readonly Incident[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityIncident.findMany({
        where: { tenantId },
      }),
    );
    return rows.map(M.IncidentMapper.toDomain);
  }
}

// ── WORM audit ledger — append + read only ─────────────────────────────────────────────────────────
export class PrismaAuditLedgerRepository
  extends BasePrismaRepository
  implements AuditLedgerRepository
{
  async append(record: AuditRecord, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    await client.securityAuditRecord.create({
      data: M.AuditRecordMapper.toRow(record, tenantId),
    });
  }
  async tail(
    tenantRef: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<AuditRecord | null> {
    const row = await this.read(tenantId, tx, (c) =>
      c.securityAuditRecord.findFirst({
        where: { tenantId, tenantScope: tenantRef },
        orderBy: { sequence: "desc" },
      }),
    );
    return row === null ? null : M.AuditRecordMapper.toDomain(row);
  }
  async list(
    tenantRef: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly AuditRecord[]> {
    const rows = await this.read(tenantId, tx, (c) =>
      c.securityAuditRecord.findMany({
        where: { tenantId, tenantScope: tenantRef },
        orderBy: { sequence: "asc" },
      }),
    );
    return rows.map(M.AuditRecordMapper.toDomain);
  }
}
