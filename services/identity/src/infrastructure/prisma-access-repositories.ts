import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type {
  MembershipRepository,
  OrganizationRepository,
  UserRepository,
} from "../domain/access-repositories";
import type { Membership } from "../domain/membership";
import type { Organization } from "../domain/organization";
import type { User } from "../domain/user";
import { AccessMappers } from "./access.mappers";

export interface PrismaAccessRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

function requireTx(tx: unknown, what: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${what}.save requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
}

/**
 * Production `UserRepository`/`OrganizationRepository`/`MembershipRepository` on the `identity`
 * schema (additive to `PrismaCustomerRepository`'s existing tables). Email/slug uniqueness are
 * `(tenant_id, email|slug)` unique indexes — the database is the arbiter, matching Customer's own
 * pattern (D-032). Optimistic locking + same-transaction outbox per ADR-0003, identical shape to
 * `PrismaCustomerRepository`.
 */
export class PrismaUserRepository implements UserRepository {
  private readonly deps: PrismaAccessRepositoryDeps;

  constructor(deps: PrismaAccessRepositoryDeps) {
    this.deps = deps;
  }

  async save(user: User, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaUserRepository");
    const row = AccessMappers.toUserRow(user);
    if (user.version === 0) {
      await client.user.create({ data: { ...row, version: 1 } });
    } else {
      const updated = await client.user.updateMany({
        where: { id: row.id, tenantId: row.tenantId, version: user.version },
        data: { name: row.name, status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `User ${row.id} was modified concurrently (expected version ${user.version})`,
        );
      }
    }
    await this.deps.outbox.write(
      user.pullDomainEvents(),
      { ...this.deps.context, tenantId: user.tenantId },
      client,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<User | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.user.findFirst({ where: { id, tenantId } });
    return row === null ? null : AccessMappers.toUserDomain(row);
  }

  async findByEmail(email: string, tenantId: string, tx?: unknown): Promise<User | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.user.findFirst({ where: { email, tenantId } });
    return row === null ? null : AccessMappers.toUserDomain(row);
  }
}

export class PrismaOrganizationRepository implements OrganizationRepository {
  private readonly deps: PrismaAccessRepositoryDeps;

  constructor(deps: PrismaAccessRepositoryDeps) {
    this.deps = deps;
  }

  async save(organization: Organization, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaOrganizationRepository");
    const row = AccessMappers.toOrganizationRow(organization);
    if (organization.version === 0) {
      await client.organization.create({ data: { ...row, version: 1 } });
    } else {
      const updated = await client.organization.updateMany({
        where: { id: row.id, tenantId: row.tenantId, version: organization.version },
        data: { name: row.name, status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Organization ${row.id} was modified concurrently (expected version ${organization.version})`,
        );
      }
    }
    await this.deps.outbox.write(
      organization.pullDomainEvents(),
      { ...this.deps.context, tenantId: organization.tenantId },
      client,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Organization | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.organization.findFirst({ where: { id, tenantId } });
    return row === null ? null : AccessMappers.toOrganizationDomain(row);
  }

  async findBySlug(slug: string, tenantId: string, tx?: unknown): Promise<Organization | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.organization.findFirst({ where: { slug, tenantId } });
    return row === null ? null : AccessMappers.toOrganizationDomain(row);
  }
}

export class PrismaMembershipRepository implements MembershipRepository {
  private readonly deps: PrismaAccessRepositoryDeps;

  constructor(deps: PrismaAccessRepositoryDeps) {
    this.deps = deps;
  }

  async save(membership: Membership, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaMembershipRepository");
    const row = AccessMappers.toMembershipRow(membership);
    if (membership.version === 0) {
      await client.membership.create({ data: { ...row, version: 1 } });
    } else {
      const updated = await client.membership.updateMany({
        where: { id: row.id, tenantId: row.tenantId, version: membership.version },
        data: { roleName: row.roleName, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Membership ${row.id} was modified concurrently (expected version ${membership.version})`,
        );
      }
    }
    await this.deps.outbox.write(
      membership.pullDomainEvents(),
      { ...this.deps.context, tenantId: membership.tenantId },
      client,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Membership | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.membership.findFirst({ where: { id, tenantId } });
    return row === null ? null : AccessMappers.toMembershipDomain(row);
  }

  async findByUserAndOrganization(
    userId: string,
    organizationId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Membership | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.membership.findFirst({ where: { userId, organizationId, tenantId } });
    return row === null ? null : AccessMappers.toMembershipDomain(row);
  }
}
