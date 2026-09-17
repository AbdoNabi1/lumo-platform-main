import type { CursorPage, Paginated } from "@platform/types";
import type { Tenant } from "./tenant";
import type { Workspace } from "./workspace";

/**
 * ADR-0014 (WP-10, T10.3): `findById`/`findBySlug`/`list` take `tenantId` as an explicit per-call
 * parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet
 * converted.
 */
export interface TenantRepository {
  save(tenant: Tenant, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Tenant | null>;
  findBySlug(slug: string, tenantId: string, tx?: unknown): Promise<Tenant | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Tenant>>;
}

/** Persistence port for {@link Workspace}. Same ADR-0014 shape as {@link TenantRepository}. */
export interface WorkspaceRepository {
  save(workspace: Workspace, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Workspace | null>;
  findByTenantRefAndName(
    tenantRef: string,
    name: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Workspace | null>;
  /**
   * The tenant's current/primary workspace — no `tenantRef` argument needed: every repository
   * instance is already scoped to one tenant (ADR-0008; `PrismaWorkspaceRepository` filters every
   * query by its own `tenantId`, `InMemoryWorkspaceRepository` is one instance per `wireTenancy()`
   * call). Prefers an active `"production"` workspace; falls back to the most-recently-updated
   * active workspace of any env when no production workspace exists yet.
   */
  findCurrent(tenantId: string, tx?: unknown): Promise<Workspace | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Workspace>>;
}
