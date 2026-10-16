import type { IdGenerator } from "@platform/contracts";
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type {
  IdentityMembershipRecord,
  IdentityOrganizationRecord,
  IdentityProjectionStore,
  IdentityUserRecord,
} from "../application/ports";

export interface PrismaIdentityProjectionDeps {
  readonly prisma: Database;
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

  /** ADR-0014: reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  private scoped<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }

  async upsertUser(record: IdentityUserRecord, tenantId: string, tx?: unknown): Promise<void> {
    await this.scoped(tenantId, tx, async (client) => {
      const existing = await client.securityIdentityUser.findFirst({
        where: { tenantId, userId: record.userId },
      });
      if (existing === null) {
        await client.securityIdentityUser.create({
          data: {
            id: this.deps.idGenerator.generate(),
            tenantId,
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
        where: { tenantId, userId: record.userId },
        data: {
          userTenant: record.userTenant,
          status: record.status,
          occurredAt: record.occurredAt,
        },
      });
    });
  }

  async setUserStatus(
    userId: string,
    status: IdentityUserRecord["status"],
    occurredAt: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<void> {
    await this.scoped(tenantId, tx, async (client) => {
      const existing = await client.securityIdentityUser.findFirst({
        where: { tenantId, userId },
      });
      if (existing === null) {
        await client.securityIdentityUser.create({
          data: {
            id: this.deps.idGenerator.generate(),
            tenantId,
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
        where: { tenantId, userId },
        data: { status, occurredAt },
      });
    });
  }

  async getUser(
    userId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<IdentityUserRecord | null> {
    const row = await this.scoped(tenantId, tx, (c) =>
      c.securityIdentityUser.findFirst({
        where: { tenantId, userId },
      }),
    );
    return row === null
      ? null
      : {
          userId: row.userId,
          userTenant: row.userTenant,
          status: row.status as IdentityUserRecord["status"],
          occurredAt: row.occurredAt,
        };
  }

  async upsertOrganization(
    record: IdentityOrganizationRecord,
    tenantId: string,
    tx?: unknown,
  ): Promise<void> {
    await this.scoped(tenantId, tx, async (client) => {
      const existing = await client.securityIdentityOrganization.findFirst({
        where: { tenantId, organizationId: record.organizationId },
      });
      if (existing === null) {
        await client.securityIdentityOrganization.create({
          data: {
            id: this.deps.idGenerator.generate(),
            tenantId,
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
        where: { tenantId, organizationId: record.organizationId },
        data: { slug: record.slug, orgTenant: record.orgTenant, occurredAt: record.occurredAt },
      });
    });
  }

  async getOrganization(
    organizationId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<IdentityOrganizationRecord | null> {
    const row = await this.scoped(tenantId, tx, (c) =>
      c.securityIdentityOrganization.findFirst({
        where: { tenantId, organizationId },
      }),
    );
    return row === null
      ? null
      : {
          organizationId: row.organizationId,
          slug: row.slug,
          orgTenant: row.orgTenant,
          occurredAt: row.occurredAt,
        };
  }

  async upsertMembership(
    record: IdentityMembershipRecord,
    tenantId: string,
    tx?: unknown,
  ): Promise<void> {
    await this.scoped(tenantId, tx, async (client) => {
      const existing = await client.securityIdentityMembership.findFirst({
        where: { tenantId, membershipId: record.membershipId },
      });
      if (existing === null) {
        await client.securityIdentityMembership.create({
          data: {
            id: this.deps.idGenerator.generate(),
            tenantId,
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
        where: { tenantId, membershipId: record.membershipId },
        data: {
          userId: record.userId,
          organizationId: record.organizationId,
          role: record.role,
          occurredAt: record.occurredAt,
        },
      });
    });
  }

  async setMembershipRole(
    membershipId: string,
    role: string,
    occurredAt: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<void> {
    await this.scoped(tenantId, tx, async (client) => {
      const existing = await client.securityIdentityMembership.findFirst({
        where: { tenantId, membershipId },
      });
      if (existing === null || existing.occurredAt > occurredAt) return; // create precedes role-change; LWW
      await client.securityIdentityMembership.updateMany({
        where: { tenantId, membershipId },
        data: { role, occurredAt },
      });
    });
  }

  async listMembershipsByUser(
    userId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly IdentityMembershipRecord[]> {
    const rows = await this.scoped(tenantId, tx, (c) =>
      c.securityIdentityMembership.findMany({
        where: { tenantId, userId },
      }),
    );
    return rows.map((r) => ({
      membershipId: r.membershipId,
      userId: r.userId,
      organizationId: r.organizationId,
      role: r.role,
      occurredAt: r.occurredAt,
    }));
  }
}
