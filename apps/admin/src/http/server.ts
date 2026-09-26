import type { Authenticator, Cache, IdempotencyKeyStore, RateLimiter } from "@platform/contracts";
import { HealthRegistry } from "@platform/health";
import {
  claimTenantResolver,
  createHttpServer,
  headerTenantResolver,
  publicHeaderTenantResolver,
  registerRoutes,
  type HttpMetricsSink,
  type HttpServerDeps,
  type TenantGate,
  type TenantResolver,
} from "@platform/http";
import type { FastifyInstance } from "fastify";
import { logger } from "@platform/utils";
import { AllowAllAccessControl } from "../infrastructure/allow-all-access-control";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { AdminGuard } from "../interfaces/admin-guard";
import { wireAdmin, type AdminWiringDeps } from "../composition";
import { assertMultiTenantReady } from "../tenant-mode-guard";
import { CachedTenantGate } from "../tenant-status-gate";
import { adminRoutes } from "./admin-routes";

export interface AdminHttpDeps extends AdminWiringDeps {
  /**
   * T10.4. `single` (default) keeps every request locked to `tenantId` via
   * `singleTenantGuardedResolver`. `multi` resolves the tenant per request (verified claim, then
   * header), refuses to boot unless `assertMultiTenantReady` passes, and pins the one exempted
   * context (tenancy, ADR-0014 8f) to `tenantId`. Making multi mode possible is not making it safe:
   * that is T10.5's adversarial isolation suite.
   */
  readonly tenantMode?: "single" | "multi";
  readonly authenticator: Authenticator;
  readonly rateLimiter: RateLimiter;
  readonly idempotencyKeys: IdempotencyKeyStore;
  readonly responseCache: Cache;
  readonly health?: HealthRegistry;
  /**
   * Optional metrics sink (F5). Present ⇒ every response is counted and `http_requests_total` /
   * `http_request_duration_ms_sum` are appended to `/metrics`; absent ⇒ unchanged from before this
   * field existed, so tests and any caller that does not measure are unaffected.
   */
  readonly metrics?: HttpMetricsSink;
  /** H-04 (audit): forwarded to `HttpServerDeps` unchanged — see that field's own doc comment. */
  readonly exposeDocs?: boolean;
  /** H-04 (audit): forwarded to `HttpServerDeps` unchanged — see that field's own doc comment. */
  readonly readinessDetail?: "full" | "status-only";
  /**
   * T10.6: how long this instance may keep a tenant's lifecycle status before re-reading it - the upper
   * bound on how late a suspension made on ANOTHER instance is seen here (the instance that makes the
   * change sees it immediately). Default 10s. Only used under TENANT_MODE=multi.
   */
  readonly tenantStatusTtlMs?: number;
  /**
   * T10.6: replaces the lifecycle source (default: the tenancy context's rows behind a
   * `CachedTenantGate`). For embedders and for tests whose fixture tenants have no `Tenant` row; the
   * production composition (apps/runtime/src/api.ts) never passes it. Only used under multi.
   */
  readonly tenantGate?: TenantGate;
}

const DEFAULT_TENANT_STATUS_TTL_MS = 10_000;

/**
 * Guards the resolved request tenant against the single tenant every Prisma repository was pinned
 * to at composition time (C2-6). `wireX({ prisma, tenantId })` (ADR-0008) takes `tenantId` only at
 * construction, never per call — every context's repositories are already closed over
 * `deps.tenantId` when `wireAdmin(deps)` builds them. A resolved request tenant that differed from
 * that pinned value would still hit the SAME repositories, i.e. silently read/write the wrong
 * tenant's rows. Returning `null` here (instead of the mismatched id) makes the pipeline treat the
 * request exactly like an unresolved tenant, which `packages/http/src/server.ts` already fails
 * closed on ("No tenant resolved for this request") — this closes the leak with the app's own
 * existing guard, not a new one. When `deps.tenantId` is absent (in-memory composition — no
 * repository is pinned to anything) behavior is byte-for-byte unchanged from before this guard
 * existed.
 */
export function singleTenantGuardedResolver(pinnedTenantId: string | undefined): TenantResolver {
  return (input) => {
    const resolved = headerTenantResolver(input);
    if (pinnedTenantId === undefined) return resolved;
    return resolved === pinnedTenantId ? resolved : null;
  };
}

/**
 * What the deployment mode decides about the platform scope, in one place so it can be tested without
 * booting. Under multi, "nothing to pin to" means NOTHING qualifies (`""`), never "no restriction":
 *  - `platformTenantId` — the tenant that is always available and may use the operator routes;
 *  - `legacyStorageKeys` — unprefixed storage keys stay signable only where there is one tenant (G-68);
 *  - `tenancyPinnedTo` — the tenant the tenancy context (ADR-0014 8f) is pinned to; every other tenant is refused.
 */
export function deploymentScope(
  deps: Pick<AdminHttpDeps, "tenantMode" | "tenantId" | "platformTenantId" | "legacyStorageKeys">,
) {
  const multi = deps.tenantMode === "multi";
  return {
    platformTenantId: deps.platformTenantId ?? (multi ? (deps.tenantId ?? "") : undefined),
    legacyStorageKeys: deps.legacyStorageKeys ?? (multi ? ("refuse" as const) : ("allow" as const)),
    tenancyPinnedTo: multi ? (deps.tenantId ?? "") : undefined,
  };
}

/**
 * The admin API composition root (Sprint 2.6): wires the Phase-1 admin facade behind the
 * production HTTP transport. `AdminGuard` (ADR-0007/0009) IS the transport's permission guard —
 * one policy engine, injected structurally (packages never import apps). Tenant resolution is
 * header-based for this internal surface (behind authentication); the storefront tier resolves
 * by domain (doc 25 §3). In production the composition receives Ory/Redis adapters; tests
 * inject fakes — the transport cannot tell the difference, which is the point.
 */
export async function createAdminHttpApi(deps: AdminHttpDeps): Promise<FastifyInstance> {
  // G-68: unprefixed legacy storage keys stay signable only where there is one tenant. Explicit, and
  // overridable by the caller, never inferred from data.
  const scope = deploymentScope(deps);
  const platformTenantId = scope.platformTenantId;
  const admin = wireAdmin({
    ...deps,
    legacyStorageKeys: scope.legacyStorageKeys,
    // WP-14: under multi the platform-operator tenant is the deployment tenant (ADR-0014 8f, the same
    // scope the tenancy routes are pinned to). Missing there ⇒ "" ⇒ no tenant qualifies: fail closed.
    platformTenantId,
  });
  const guard = new AdminGuard({
    accessControl: deps.accessControl ?? new AllowAllAccessControl(),
    auditTrail: deps.auditTrail ?? new InMemoryAuditTrail(),
    clock: deps.clock,
  });

  const multi = deps.tenantMode === "multi";
  // Claim FIRST, and the header only for UNAUTHENTICATED requests (T10.5): a forged `x-tenant-id` must
  // neither override a verified token's tenant nor supply one for a token that has none.
  const tenantResolvers: readonly TenantResolver[] = multi
    ? [claimTenantResolver, publicHeaderTenantResolver]
    : [singleTenantGuardedResolver(deps.tenantId)];
  if (multi) assertMultiTenantReady({ resolvers: tenantResolvers, graph: admin });

  // T10.6 (Gap 1): under multi, every request's tenant is checked for lifecycle status where the tenant is
  // resolved. Single mode has one deployment tenant with no lifecycle row, so no gate is mounted there.
  const cachedGate = multi
    ? new CachedTenantGate({
        load: admin.tenantAvailability,
        platformTenantId: platformTenantId ?? "",
        ttlMs: deps.tenantStatusTtlMs ?? DEFAULT_TENANT_STATUS_TTL_MS,
      })
    : undefined;
  const tenantGate: TenantGate | undefined = multi ? (deps.tenantGate ?? cachedGate) : undefined;

  const httpDeps: HttpServerDeps = {
    logger,
    idGenerator: deps.idGenerator,
    authenticator: deps.authenticator,
    guard,
    tenantResolvers,
    ...(tenantGate === undefined ? {} : { tenantGate }),
    rateLimiter: deps.rateLimiter,
    rateLimit: { limit: 300, windowMs: 60_000 },
    idempotencyKeys: deps.idempotencyKeys,
    responseCache: deps.responseCache,
    ...(deps.metrics === undefined ? {} : { metrics: deps.metrics }),
    ...(deps.exposeDocs === undefined ? {} : { exposeDocs: deps.exposeDocs }),
    ...(deps.readinessDetail === undefined ? {} : { readinessDetail: deps.readinessDetail }),
    health: deps.health ?? new HealthRegistry(),
    api: {
      title: "Morbeh Admin API",
      description: "Backoffice API over the Phase-1 admin facade (v1).",
    },
  };

  const app = createHttpServer(httpDeps);
  await registerRoutes(
    app,
    httpDeps,
    adminRoutes(admin, {
      ...(scope.tenancyPinnedTo === undefined ? {} : { tenancyPinnedTo: scope.tenancyPinnedTo }),
      rateLimiter: deps.rateLimiter,
      ...(tenantGate === undefined
        ? {}
        : { onTenantLifecycleChange: (id: string) => cachedGate?.invalidate(id) }),
    }),
  );
  await app.ready();
  return app;
}
