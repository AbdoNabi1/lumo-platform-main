import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConflictError } from "@platform/utils";
import type {
  ShopDomainRepository,
  StaffDirectoryRepository,
  StoreSettingsRepository,
  TenantRepository,
  WorkspaceRepository,
} from "../domain/repositories";
import type { ShopDomain } from "../domain/shop-domain";
import type { StaffDirectoryEntry } from "../domain/staff-directory";
import { StoreSettings, type SiteType } from "../domain/store-settings";
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

  async findById(id: string): Promise<Tenant | null> {
    return this.store.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    for (const tenant of this.store.values()) {
      if (tenant.slug.value === slug) return tenant;
    }
    return null;
  }

  async list(page: CursorPage): Promise<Paginated<Tenant>> {
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

  async findById(id: string): Promise<Workspace | null> {
    return this.store.get(id) ?? null;
  }

  async findByTenantRefAndName(tenantRef: string, name: string): Promise<Workspace | null> {
    for (const workspace of this.store.values()) {
      if (workspace.tenantRef === tenantRef && workspace.name === name) return workspace;
    }
    return null;
  }

  /** Prefers an active `"production"` workspace; falls back to the first active workspace found (insertion order). */
  async findCurrent(): Promise<Workspace | null> {
    let fallback: Workspace | null = null;
    for (const workspace of this.store.values()) {
      if (workspace.status !== "active") continue;
      if (workspace.env === "production") return workspace;
      fallback ??= workspace;
    }
    return fallback;
  }

  async list(page: CursorPage): Promise<Paginated<Workspace>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemoryShopDomainRepository implements ShopDomainRepository {
  private readonly store = new Map<string, ShopDomain>();

  async save(domain: ShopDomain): Promise<void> {
    this.store.set(domain.id.toString(), domain);
  }

  async findById(id: string): Promise<ShopDomain | null> {
    return this.store.get(id) ?? null;
  }

  async findByHostname(hostname: string): Promise<ShopDomain | null> {
    for (const domain of this.store.values()) {
      if (domain.hostname.value === hostname) return domain;
    }
    return null;
  }

  async listByShop(shopRef: string): Promise<readonly ShopDomain[]> {
    return [...this.store.values()]
      .filter((domain) => domain.shopRef === shopRef)
      .sort((a, b) => a.hostname.value.localeCompare(b.hostname.value));
  }
}

export class InMemoryStaffDirectoryRepository implements StaffDirectoryRepository {
  private readonly store = new Map<string, StaffDirectoryEntry>();

  findByEmail(email: string): Promise<StaffDirectoryEntry | null> {
    return Promise.resolve(this.store.get(email) ?? null);
  }

  create(entry: StaffDirectoryEntry): Promise<void> {
    // Synchronous check-and-set: two concurrent callers cannot both pass it.
    if (this.store.has(entry.email)) {
      return Promise.reject(new ConflictError("Email already has a store"));
    }
    this.store.set(entry.email, entry);
    return Promise.resolve();
  }

  save(entry: StaffDirectoryEntry): Promise<void> {
    if (!this.store.has(entry.email)) {
      return Promise.reject(new Error("staff directory entry does not exist"));
    }
    this.store.set(entry.email, entry);
    return Promise.resolve();
  }

  delete(entry: StaffDirectoryEntry): Promise<boolean> {
    const current = this.store.get(entry.email);
    if (
      current === undefined ||
      current.shopId !== entry.shopId ||
      current.ownerExternalId !== entry.ownerExternalId
    ) {
      return Promise.resolve(false);
    }
    this.store.delete(entry.email);
    return Promise.resolve(true);
  }
}

interface StoreSettingsRecord {
  readonly settings: StoreSettings;
  readonly siteTypeSettledAt: Date | null;
}

/**
 * Mirrors the Prisma adapter: a save keeps the stored site type (a new row gets "store"), and the
 * type changes only in `settleSignupSiteType`. Every operation is synchronous up to its return, so
 * check-and-set is atomic exactly like the single-row SQL writes.
 */
export class InMemoryStoreSettingsRepository implements StoreSettingsRepository {
  private readonly rows = new Map<string, StoreSettingsRecord>();

  get(tenantId: string): Promise<StoreSettings | null> {
    return Promise.resolve(this.rows.get(tenantId)?.settings ?? null);
  }

  save(tenantId: string, settings: StoreSettings): Promise<void> {
    this.write(tenantId, settings);
    return Promise.resolve();
  }

  modify(
    tenantId: string,
    change: (current: StoreSettings) => StoreSettings,
  ): Promise<StoreSettings> {
    const current = this.rows.get(tenantId)?.settings ?? StoreSettings.defaults();
    return Promise.resolve(this.write(tenantId, change(current)));
  }

  settleSignupSiteType(tenantId: string, requested: SiteType, at: Date): Promise<SiteType> {
    const row = this.rows.get(tenantId);
    if (row === undefined) {
      this.rows.set(tenantId, {
        settings: StoreSettings.defaults().withSiteType(requested),
        siteTypeSettledAt: at,
      });
      return Promise.resolve(requested);
    }
    if (row.siteTypeSettledAt === null) {
      this.rows.set(tenantId, {
        settings: row.settings.withSiteType(requested),
        siteTypeSettledAt: at,
      });
      return Promise.resolve(requested);
    }
    return Promise.resolve(row.settings.siteType);
  }

  /** Stores `settings` with the type already persisted (never the incoming one); returns the row. */
  private write(tenantId: string, settings: StoreSettings): StoreSettings {
    const existing = this.rows.get(tenantId);
    const persisted = settings.withSiteType(existing?.settings.siteType ?? "store");
    this.rows.set(tenantId, {
      settings: persisted,
      siteTypeSettledAt: existing?.siteTypeSettledAt ?? null,
    });
    return persisted;
  }
}
