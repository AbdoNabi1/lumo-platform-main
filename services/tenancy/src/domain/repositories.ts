import type { CursorPage, Paginated } from "@platform/types";
import type { ShopDomain } from "./shop-domain";
import type { StoreSettings } from "./store-settings";
import type { Tenant } from "./tenant";
import type { Workspace } from "./workspace";

export interface TenantRepository {
  save(tenant: Tenant, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Tenant | null>;
  findBySlug(slug: string, tx?: unknown): Promise<Tenant | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Tenant>>;
}

export interface WorkspaceRepository {
  save(workspace: Workspace, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Workspace | null>;
  findByTenantRefAndName(tenantRef: string, name: string, tx?: unknown): Promise<Workspace | null>;
  /**
   * The tenant's current/primary workspace — no `tenantRef` argument needed: every repository
   * instance is already scoped to one tenant (ADR-0008; `PrismaWorkspaceRepository` filters every
   * query by its own `tenantId`, `InMemoryWorkspaceRepository` is one instance per `wireTenancy()`
   * call). Prefers an active `"production"` workspace; falls back to the most-recently-updated
   * active workspace of any env when no production workspace exists yet.
   */
  findCurrent(tx?: unknown): Promise<Workspace | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Workspace>>;
}

export interface ShopDomainRepository {
  save(domain: ShopDomain, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<ShopDomain | null>;
  /** `hostname` is already normalised (`Hostname.value`). Unique across the whole platform. */
  findByHostname(hostname: string, tx?: unknown): Promise<ShopDomain | null>;
  listByShop(shopRef: string, tx?: unknown): Promise<readonly ShopDomain[]>;
}

/**
 * One row per shop. Like every Tenancy repository it is scoped to the tenant its composition was
 * built for (ADR-0008); there is no tenant argument.
 */
export interface StoreSettingsRepository {
  /** `null` until the merchant has saved once; callers fall back to {@link StoreSettings.defaults}. */
  get(tx?: unknown): Promise<StoreSettings | null>;
  save(settings: StoreSettings, tx?: unknown): Promise<void>;
}
