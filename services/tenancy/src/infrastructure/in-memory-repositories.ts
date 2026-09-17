import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { TenantRepository, WorkspaceRepository } from "../domain/repositories";
import type { Tenant } from "../domain/tenant";
import type { Workspace } from "../domain/workspace";

/** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
function paginate<T extends { readonly id: { toString(): string } }>(
  rows: readonly T[],
  page: CursorPage,
): Paginated<T> {
  const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
  const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
  const start = after === undefined ? 0 : sorted.findIndex((x) => x.id.toString() > after);
  const limit = normalizePageSize(page.first);
  const window = start < 0 ? [] : sorted.slice(start, start + limit + 1);
  return buildPaginatedPage(window, limit, (x) => x.id.toString());
}

export interface InMemoryTenancyRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

export class InMemoryTenantRepository implements TenantRepository {
  private readonly store = new Map<string, Tenant>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryTenancyRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(tenant: Tenant, tx?: unknown): Promise<void> {
    this.store.set(tenant.id.toString(), tenant);
    await this.outbox.write(tenant.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Tenant | null> {
    return this.store.get(id) ?? null;
  }

  async findBySlug(slug: string, _tenantId: string): Promise<Tenant | null> {
    for (const tenant of this.store.values()) {
      if (tenant.slug.value === slug) return tenant;
    }
    return null;
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Tenant>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly store = new Map<string, Workspace>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryTenancyRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(workspace: Workspace, tx?: unknown): Promise<void> {
    this.store.set(workspace.id.toString(), workspace);
    await this.outbox.write(workspace.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Workspace | null> {
    return this.store.get(id) ?? null;
  }

  async findByTenantRefAndName(
    tenantRef: string,
    name: string,
    _tenantId: string,
  ): Promise<Workspace | null> {
    for (const workspace of this.store.values()) {
      if (workspace.tenantRef === tenantRef && workspace.name === name) return workspace;
    }
    return null;
  }

  /** Prefers an active `"production"` workspace; falls back to the first active workspace found (insertion order). */
  async findCurrent(_tenantId: string): Promise<Workspace | null> {
    let fallback: Workspace | null = null;
    for (const workspace of this.store.values()) {
      if (workspace.status !== "active") continue;
      if (workspace.env === "production") return workspace;
      fallback ??= workspace;
    }
    return fallback;
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Workspace>> {
    return paginate([...this.store.values()], page);
  }
}
