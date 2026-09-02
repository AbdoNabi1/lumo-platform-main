import type { Authenticator, Cache, IdempotencyKeyStore, RateLimiter } from "@platform/contracts";
import { HealthRegistry } from "@platform/health";
import {
  createHttpServer,
  headerTenantResolver,
  registerRoutes,
  type HttpMetricsSink,
  type HttpServerDeps,
  type TenantResolver,
} from "@platform/http";
import type { FastifyInstance } from "fastify";
import { logger } from "@platform/utils";
import { AllowAllAccessControl } from "../infrastructure/allow-all-access-control";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { AdminGuard } from "../interfaces/admin-guard";
import { wireAdmin, type AdminWiringDeps } from "../composition";
import { adminRoutes } from "./admin-routes";

export interface AdminHttpDeps extends AdminWiringDeps {
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
}

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
function singleTenantGuardedResolver(pinnedTenantId: string | undefined): TenantResolver {
  return (input) => {
    const resolved = headerTenantResolver(input);
    if (pinnedTenantId === undefined) return resolved;
    return resolved === pinnedTenantId ? resolved : null;
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
  const admin = wireAdmin(deps);
  const guard = new AdminGuard({
    accessControl: deps.accessControl ?? new AllowAllAccessControl(),
    auditTrail: deps.auditTrail ?? new InMemoryAuditTrail(),
    clock: deps.clock,
  });

  const httpDeps: HttpServerDeps = {
    logger,
    idGenerator: deps.idGenerator,
    authenticator: deps.authenticator,
    guard,
    tenantResolvers: [singleTenantGuardedResolver(deps.tenantId)],
    rateLimiter: deps.rateLimiter,
    rateLimit: { limit: 300, windowMs: 60_000 },
    idempotencyKeys: deps.idempotencyKeys,
    responseCache: deps.responseCache,
    ...(deps.metrics === undefined ? {} : { metrics: deps.metrics }),
    ...(deps.exposeDocs === undefined ? {} : { exposeDocs: deps.exposeDocs }),
    ...(deps.readinessDetail === undefined ? {} : { readinessDetail: deps.readinessDetail }),
    health: deps.health ?? new HealthRegistry(),
    api: {
      title: "Lumo Admin API",
      description: "Backoffice API over the Phase-1 admin facade (v1).",
    },
  };

  const app = createHttpServer(httpDeps);
  await registerRoutes(app, httpDeps, adminRoutes(admin));
  await app.ready();
  return app;
}
