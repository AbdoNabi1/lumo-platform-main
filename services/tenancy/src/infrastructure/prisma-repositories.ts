import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { TenantRepository, WorkspaceRepository } from "../domain/repositories";
import type { Tenant } from "../domain/tenant";
import type { Workspace } from "../domain/workspace";
import { TenantMapper, WorkspaceMapper, type TenantRow, type WorkspaceRow } from "./mappers";

export interface PrismaTenancyRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  readonly tenantId: string;
}

export class PrismaTenantRepository implements TenantRepository {
  private readonly deps: PrismaTenancyRepositoriesDeps;

  constructor(deps: PrismaTenancyRepositoriesDeps) {
    this.deps = deps;
  }

  async save(tenant: Tenant, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = tenant.id.toString();
    const row = TenantMapper.toRow(tenant, tenantId);
    if (tenant.version === 0) {
      await client.tenant.create({
        data: { ...row, branding: row.branding },
      });
    } else {
      const updated = await client.tenant.updateMany({
        where: { id, tenantId, version: tenant.version },
        data: {
          name: row.name,
          status: row.status,
          isolationTier: row.isolationTier,
          branding: row.branding,
          subscriptionRef: row.subscriptionRef,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConcurrencyError(`Tenant ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(tenant.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Tenant | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.tenant.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : TenantMapper.toDomain(row as TenantRow);
  }

  async findBySlug(slug: string, tx?: unknown): Promise<Tenant | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.tenant.findFirst({ where: { slug, tenantId: this.deps.tenantId } });
    return row === null ? null : TenantMapper.toDomain(row as TenantRow);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Tenant>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.tenant.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => TenantMapper.toDomain(row as TenantRow)),
      limit,
      (t) => t.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) throw new Error("requires transaction client (ADR-0003)");
    return tx as TransactionClient;
  }
}

export class PrismaWorkspaceRepository implements WorkspaceRepository {
  private readonly deps: PrismaTenancyRepositoriesDeps;

  constructor(deps: PrismaTenancyRepositoriesDeps) {
    this.deps = deps;
  }

  async save(workspace: Workspace, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = workspace.id.toString();
    const row = WorkspaceMapper.toRow(workspace, tenantId);
    if (workspace.version === 0) {
      await client.workspace.create({
        data: { ...row, config: row.config as Prisma.InputJsonValue },
      });
    } else {
      const updated = await client.workspace.updateMany({
        where: { id, tenantId, version: workspace.version },
        data: {
          name: row.name,
          status: row.status,
          config: row.config as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`Workspace ${id} was modified concurrently`);
    }
    await this.deps.outbox.write(workspace.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Workspace | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.workspace.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : WorkspaceMapper.toDomain(row as WorkspaceRow);
  }

  async findByTenantRefAndName(
    tenantRef: string,
    name: string,
    tx?: unknown,
  ): Promise<Workspace | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.workspace.findFirst({
      where: { tenantRef, name, tenantId: this.deps.tenantId },
    });
    return row === null ? null : WorkspaceMapper.toDomain(row as WorkspaceRow);
  }

  /** Prefers an active `"production"` workspace; falls back to the most-recently-updated active workspace of any env. */
  async findCurrent(tx?: unknown): Promise<Workspace | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const production = await client.workspace.findFirst({
      where: { tenantId: this.deps.tenantId, status: "active", env: "production" },
    });
    if (production !== null) return WorkspaceMapper.toDomain(production as WorkspaceRow);

    const fallback = await client.workspace.findFirst({
      where: { tenantId: this.deps.tenantId, status: "active" },
      orderBy: { updatedAt: "desc" },
    });
    return fallback === null ? null : WorkspaceMapper.toDomain(fallback as WorkspaceRow);
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Workspace>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.workspace.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => WorkspaceMapper.toDomain(row as WorkspaceRow)),
      limit,
      (w) => w.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) throw new Error("requires transaction client (ADR-0003)");
    return tx as TransactionClient;
  }
}
