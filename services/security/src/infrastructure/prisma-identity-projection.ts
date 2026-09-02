import type { IdGenerator } from "@platform/contracts";
import type { Database, TransactionClient } from "@platform/db";
import type {
  IdentityMembershipRecord,
  IdentityOrganizationRecord,
  IdentityProjectionStore,
  IdentityUserRecord,
} from "../application/ports";

export interface PrismaIdentityProjectionDeps {
  readonly prisma: Database;
  /** Row scope for every query/write (ADR-0008). */
  readonly tenantId: string;
  readonly idGenerator: IdGenerator;
}

/**
 * Postgres-backed {@link IdentityProjectionStore} (H-2, G-SEC-4) — the durable read projection of
 * Identity's Users/Organizations/Memberships that Security resolves against. Every row is tenant-scoped
 * (ADR-0008). All writes are **last-writer-wins by `occurredAt`**: an incoming fact only replaces a
 * strictly-older stored one, so out-of-order / redelivered events converge and never regress. Identity
 * remains the owner — this is a read copy, never a second source of truth, never written back.
 */
export class PrismaIdentityProjectionStore implements IdentityProjectionStore {
  constructor(private readonly deps: PrismaIdentityProjectionDeps) {}

  private reader(tx: unknown): TransactionClient | Database {
    return (tx as TransactionClient | undefined) ?? this.deps.prisma;
  }

  async upsertUser(record: IdentityUserRecord, tx?: unknown): Promise<void> {
    const client = this.reader(tx);
    const existing = await client.securityIdentityUser.findFirst({
      where: { tenantId: this.deps.tenantId, userId: record.userId },
    });
    if (existing === null) {
      await client.securityIdentityUser.create({
        data: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          userId: record.userId,
          userTenant: record.userTenant,
          status: record.status,
          occurredAt: record.occurredAt,
        },
      });
      return;
    }
    if (existing.occurredAt > record.occurredAt) return;
    await client.securityIdentityUser.updateMany({
      where: { tenantId: this.deps.tenantId, userId: record.userId },
      data: { userTenant: record.userTenant, status: record.status, occurredAt: record.occurredAt },
    });
  }

  async setUserStatus(
    userId: string,
    status: IdentityUserRecord["status"],
    occurredAt: string,
    tx?: unknown,
  ): Promise<void> {
    const client = this.reader(tx);
    const existing = await client.securityIdentityUser.findFirst({
      where: { tenantId: this.deps.tenantId, userId },
    });
    if (existing === null) {
      await client.securityIdentityUser.create({
        data: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          userId,
          userTenant: null,
          status,
          occurredAt,
        },
      });
      return;
    }
    if (existing.occurredAt > occurredAt) return;
    await client.securityIdentityUser.updateMany({
      where: { tenantId: this.deps.tenantId, userId },
      data: { status, occurredAt },
    });
  }

  async getUser(userId: string, tx?: unknown): Promise<IdentityUserRecord | null> {
    const row = await this.reader(tx).securityIdentityUser.findFirst({
      where: { tenantId: this.deps.tenantId, userId },
    });
    return row === null
      ? null
      : {
          userId: row.userId,
          userTenant: row.userTenant,
          status: row.status as IdentityUserRecord["status"],
          occurredAt: row.occurredAt,
        };
  }

  async upsertOrganization(record: IdentityOrganizationRecord, tx?: unknown): Promise<void> {
    const client = this.reader(tx);
    const existing = await client.securityIdentityOrganization.findFirst({
      where: { tenantId: this.deps.tenantId, organizationId: record.organizationId },
    });
    if (existing === null) {
      await client.securityIdentityOrganization.create({
        data: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          organizationId: record.organizationId,
          slug: record.slug,
          orgTenant: record.orgTenant,
          occurredAt: record.occurredAt,
        },
      });
      return;
    }
    if (existing.occurredAt > record.occurredAt) return;
    await client.securityIdentityOrganization.updateMany({
      where: { tenantId: this.deps.tenantId, organizationId: record.organizationId },
      data: { slug: record.slug, orgTenant: record.orgTenant, occurredAt: record.occurredAt },
    });
  }

  async getOrganization(
    organizationId: string,
    tx?: unknown,
  ): Promise<IdentityOrganizationRecord | null> {
    const row = await this.reader(tx).securityIdentityOrganization.findFirst({
      where: { tenantId: this.deps.tenantId, organizationId },
    });
    return row === null
      ? null
      : {
          organizationId: row.organizationId,
          slug: row.slug,
          orgTenant: row.orgTenant,
          occurredAt: row.occurredAt,
        };
  }

  async upsertMembership(record: IdentityMembershipRecord, tx?: unknown): Promise<void> {
    const client = this.reader(tx);
    const existing = await client.securityIdentityMembership.findFirst({
      where: { tenantId: this.deps.tenantId, membershipId: record.membershipId },
    });
    if (existing === null) {
      await client.securityIdentityMembership.create({
        data: {
          id: this.deps.idGenerator.generate(),
          tenantId: this.deps.tenantId,
          membershipId: record.membershipId,
          userId: record.userId,
          organizationId: record.organizationId,
          role: record.role,
          occurredAt: record.occurredAt,
        },
      });
      return;
    }
    if (existing.occurredAt > record.occurredAt) return;
    await client.securityIdentityMembership.updateMany({
      where: { tenantId: this.deps.tenantId, membershipId: record.membershipId },
      data: {
        userId: record.userId,
        organizationId: record.organizationId,
        role: record.role,
        occurredAt: record.occurredAt,
      },
    });
  }

  async setMembershipRole(
    membershipId: string,
    role: string,
    occurredAt: string,
    tx?: unknown,
  ): Promise<void> {
    const client = this.reader(tx);
    const existing = await client.securityIdentityMembership.findFirst({
      where: { tenantId: this.deps.tenantId, membershipId },
    });
    if (existing === null || existing.occurredAt > occurredAt) return; // create precedes role-change; LWW
    await client.securityIdentityMembership.updateMany({
      where: { tenantId: this.deps.tenantId, membershipId },
      data: { role, occurredAt },
    });
  }

  async listMembershipsByUser(
    userId: string,
    tx?: unknown,
  ): Promise<readonly IdentityMembershipRecord[]> {
    const rows = await this.reader(tx).securityIdentityMembership.findMany({
      where: { tenantId: this.deps.tenantId, userId },
    });
    return rows.map((r) => ({
      membershipId: r.membershipId,
      userId: r.userId,
      organizationId: r.organizationId,
      role: r.role,
      occurredAt: r.occurredAt,
    }));
  }
}
