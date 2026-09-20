import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AuthenticatedContext,
  Authenticator,
  ClaimsAuthenticator,
  Cache,
  IdGenerator,
  IdempotencyKeyStore,
  Permission,
  AuthenticatedIdentity,
  Principal,
  RateLimitDecision,
  RateLimiter,
} from "@platform/contracts";
import type { HealthReport, HealthRegistry } from "@platform/health";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  type Logger,
} from "@platform/utils";
import { InProcessRateLimiter } from "./degraded-rate-limiter";
import { mapError } from "./error-mapping";
import type { RequestContext, RouteDefinition, TransportResponse } from "./route";
import { PUBLIC_PRINCIPAL_ID, resolveTenant, type TenantResolver } from "./tenant-resolution";

/**
 * Per-request signals a guard MAY consume for a context-aware authorization decision (zero-trust). Built
 * by the transport from the verified request and passed to {@link PermissionGuard.ensure}. Every field is
 * optional and additive: the default `AdminGuard` ignores it (RBAC over principal + permission), while the
 * P2.0.2 `SecurityPermissionGuard` uses it to feed `EvaluateAccess` (session / device / IP → risk / policy).
 */
export interface GuardRequestContext {
  /** The authenticated session id (OIDC `sid` claim) — a human principal needs a valid Security session. */
  readonly sessionId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  /** Opaque device reference from the `x-device-id` header (device-trust signal). */
  readonly deviceRef?: string;
  readonly tenantId?: string;
}

/**
 * Structural twin of `apps/admin`'s `AdminGuard` (the policy-enforcement point, ADR-0007/0009).
 * Declared structurally because packages must never import apps (fitness rule) — the composition
 * root injects the real guard, so there is exactly ONE policy engine. The optional `context` is
 * additive (P2.0.2): existing two-argument guards remain structurally assignable and simply ignore it.
 */
export interface PermissionGuard {
  ensure(
    principal: Principal,
    permission: Permission,
    context?: GuardRequestContext,
  ): Promise<TransportResponse | null>;
}

/**
 * Optional metrics sink (F5 / G-19). The transport records one datapoint per response and can
 * append its Prometheus text to `/metrics`. A tiny port so `@platform/http` never depends on a
 * metrics registry — the composition root injects the implementation.
 */
export interface HttpMetricsSink {
  recordHttp(method: string, status: number, durationMs: number): void;
  renderHttp(): string;
  /**
   * H2-7: optional so every existing implementation and every test fake stays valid unchanged.
   * When present, called with each `/readyz` report so an implementation can update its own
   * dependency/readiness gauges (`health-server.ts` already does this for the worker/scheduler's
   * non-Fastify surface — this is the same call, for the API).
   */
  updateHealth?(report: HealthReport): void;
}

export interface HttpServerDeps {
  readonly logger: Logger;
  readonly idGenerator: IdGenerator;
  readonly authenticator: Authenticator;
  readonly guard: PermissionGuard;
  /** Optional metrics sink (F5); when present, requests are counted and appended to `/metrics`. */
  readonly metrics?: HttpMetricsSink;
  readonly tenantResolvers: readonly TenantResolver[];
  readonly rateLimiter: RateLimiter;
  /** Requests allowed per window per (tenant, principal) bucket. */
  readonly rateLimit: { readonly limit: number; readonly windowMs: number };
  readonly idempotencyKeys: IdempotencyKeyStore;
  /** Response-replay store for idempotent routes (Sprint 2.3/2.4 contract). */
  readonly responseCache: Cache;
  readonly health: HealthRegistry;
  readonly api: { readonly title: string; readonly description: string };
  /**
   * H-04 (audit): whether to register `/docs` (Swagger UI) and `/openapi.json`. Absent ⇒ `false`
   * (production-safe default) — these expose the full shape of every route on this server (every
   * body schema, every path) with no authentication in front of them; verified live, publicly
   * reachable on a hosted deployment before this field existed. The composition root opts in
   * explicitly for the environments where that's actually wanted (local dev) — see
   * apps/runtime/src/api.ts's `APP_ENV === "local"` gate.
   */
  readonly exposeDocs?: boolean;
  /**
   * H-04 (audit): how much detail `/readyz`'s response body carries for an unauthenticated
   * caller. `"full"` (the `HealthRegistry` report, unchanged from before this field existed)
   * includes each dependency's own error message — verified live to include the database host,
   * port, and the driver's literal connection-failure text. Absent ⇒ `"status-only"`
   * (production-safe default): only the top-level `status`, the one field a kubelet/load-balancer
   * probe actually needs. The status CODE (200/503) is unaffected either way.
   */
  readonly readinessDetail?: "full" | "status-only";
}

interface ReplaySnapshot {
  readonly status: number;
  readonly body: unknown;
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// H-02 (audit): one degraded-path limiter per distinct `deps` object (i.e. per `createHttpServer`
// call / per server instance) — a WeakMap, not a field on `HttpServerDeps`, so this needs zero
// changes to the public interface or any existing caller/test that constructs one. Only ever
// instantiated the first time the primary rate limiter throws for a `public` route on a given
// server; a healthy primary port never touches this at all.
const degradedLimiters = new WeakMap<HttpServerDeps, InProcessRateLimiter>();
function degradedLimiterFor(deps: HttpServerDeps): InProcessRateLimiter {
  let limiter = degradedLimiters.get(deps);
  if (limiter === undefined) {
    limiter = new InProcessRateLimiter();
    degradedLimiters.set(deps, limiter);
  }
  return limiter;
}

/** A fraction of the route's configured limit — see the rate-limit step's own H-02 comment for why. */
const DEGRADED_LIMIT_FACTOR = 0.5;

/** RFC 9110 §10.2.3 — `Retry-After` is whole seconds (or an HTTP-date; this codebase only ever
 * has a duration, never a fixed instant). Rounds up so a caller never retries too early, and
 * never emits `0` — a `0`-second hint reads as "retry immediately," which defeats the header's
 * purpose on a request that was in fact rejected. */
function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1_000));
}

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    correlationId: string;
    principal: Principal | null;
    tenantId: string | null;
    /** Raw JSON body bytes, captured before parsing (C2-2) — see `RequestContext.rawBody`. */
    rawBody?: Buffer;
  }
}

/**
 * The production HTTP composition (Sprint 2.6, D-047). Fastify is INFRASTRUCTURE only: routes
 * are framework-independent `RouteDefinition`s; every cross-cutting concern is an injected port.
 * Request pipeline: requestId/correlation → authenticate → tenant-resolution-first (ADR-0008;
 * no application code runs tenant-less) → authorize (single policy engine via the injected
 * guard) → rate limit → zod-parse → idempotency claim/replay → handler → uniform error mapping.
 * `/healthz` (liveness), `/readyz` (readiness via HealthRegistry), `/metrics` (process-level
 * Prometheus text; runtime metrics ride G-19), `/docs` + `/openapi.json` (generated from the
 * same zod schemas that validate — the spec can never drift from enforcement).
 */
export function createHttpServer(deps: HttpServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, genReqId: () => deps.idGenerator.generate() });
  const startedAt = Date.now();

  app.decorateRequest("requestId", "");
  app.decorateRequest("correlationId", "");
  app.decorateRequest("principal", null);
  app.decorateRequest("tenantId", null);
  app.decorateRequest("rawBody", undefined);

  // C2-2: captures the exact wire bytes before JSON-parsing them — a webhook signature (e.g.
  // Stripe's `Stripe-Signature`) is computed over these bytes verbatim, and re-serializing the
  // already-parsed body can never reproduce them byte-for-byte. Behaviourally identical to
  // Fastify's built-in JSON parser for every existing route (same `JSON.parse`, same error
  // shape via `normalizeFastifyError`'s 400 mapping below); the only addition is stashing the
  // buffer first.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      if (body.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body.toString("utf8")) as unknown);
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.addHook("onRequest", async (request, reply) => {
    request.requestId = String(request.id);
    request.correlationId = header(request, "x-correlation-id") ?? request.requestId;
    void reply.header("x-request-id", request.requestId);
    void reply.header("x-correlation-id", request.correlationId);
    const traceparent = header(request, "traceparent");
    if (traceparent !== null) void reply.header("traceparent", traceparent);
    applySecurityHeaders(request, reply);
  });

  app.addHook("onResponse", (request, reply) => {
    // F5: one datapoint per response, from the elapsed time Fastify already measured.
    deps.metrics?.recordHttp(request.method, reply.statusCode, reply.elapsedTime);
    // H-05 (audit): `request.url` includes the raw query string — a public route's caller-supplied
    // identifier (e.g. `sessionRef` on `GET /public/carts/current`, the sole proof of guest-cart
    // ownership per public-cart-routes.ts) would otherwise land in every request log verbatim.
    // `routeOptions.url` is the matched ROUTE PATTERN (e.g. "/api/v1/public/carts/current"), never
    // the literal request URL, so it carries no query-string data by construction — not merely
    // "usually safe to log" but structurally unable to contain a caller-supplied value.
    deps.logger.info("http request", {
      method: request.method,
      path: request.routeOptions.url ?? "unmatched",
      status: reply.statusCode,
      requestId: request.requestId,
      correlationId: request.correlationId,
      tenantId: request.tenantId,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(normalizeFastifyError(error), request.correlationId);
    if (mapped.status >= 500) {
      deps.logger.error("http request failed", {
        requestId: request.requestId,
        correlationId: request.correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    void reply.status(mapped.status).send(mapped.envelope);
  });

  registerOperationalEndpoints(app, deps, startedAt);
  return app;
}

/** Registers versioned business routes + OpenAPI. Call once with every route, then `ready()`. */
export async function registerRoutes(
  app: FastifyInstance,
  deps: HttpServerDeps,
  routes: readonly RouteDefinition<never, never, never>[] | readonly RouteDefinition[],
): Promise<void> {
  // H-04 (audit): registering these unconditionally put the full shape of every route on this
  // server — every body schema, every path — behind no authentication whatsoever, and it was
  // verified publicly reachable that way on a hosted deployment. `deps.exposeDocs` defaults to
  // `false` (see that field's own doc comment); `app.route()` below still works identically
  // either way — its per-route `schema` is Fastify's own route schema (used for request-shape
  // bookkeeping regardless of the swagger plugin, and `validatorCompiler` below bypasses AJV
  // validation against it either way), not something `@fastify/swagger` adds.
  if (deps.exposeDocs === true) {
    await app.register(swagger, {
      openapi: {
        info: { title: deps.api.title, description: deps.api.description, version: "1.0.0" },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
    app.get("/openapi.json", () => app.swagger());
  }

  for (const route of routes) {
    const url = `/api/v${route.version}${route.path}`;
    app.route({
      method: route.method,
      url,
      schema: {
        summary: route.summary,
        tags: [`v${route.version}`],
        security: route.public === true ? [] : [{ bearerAuth: [] }],
        ...(route.schema.body ? { body: zodToJsonSchema(route.schema.body) } : {}),
        ...(route.schema.params ? { params: zodToJsonSchema(route.schema.params) } : {}),
        ...(route.schema.querystring
          ? { querystring: zodToJsonSchema(route.schema.querystring) }
          : {}),
      },
      // zod is the runtime validator (Fastify's ajv is bypassed for parsing fidelity).
      validatorCompiler: () => () => true,
      handler: async (request, reply) => {
        const response = await executeRoute(route, request, deps);
        if (response.headers !== undefined) {
          for (const [name, value] of Object.entries(response.headers)) {
            void reply.header(name, value);
          }
        }
        void reply.status(response.status).send(response.body);
      },
    });
  }
}

/**
 * The fixed anonymous identity. It has no tenant of its own: the request's resolved tenant is bound
 * to it below (`actor`), so the public principal carries the tenant the storefront request IS for.
 */
const PUBLIC_IDENTITY: AuthenticatedIdentity = {
  id: PUBLIC_PRINCIPAL_ID,
  kind: "customer",
  roles: [],
};

async function executeRoute(
  route: RouteDefinition,
  request: FastifyRequest,
  deps: HttpServerDeps,
): Promise<TransportResponse> {
  // 1. Authenticate (Authenticator port; claims-aware adapters — JwtVerifier/Kratos, Sprint
  //    2.7 — expose verified claims for tenant resolution; null ⇒ 401). A `public` route (Phase 9
  //    hardening) accepts anonymous traffic instead — it resolves to a fixed principal rather than
  //    running the same verification every authenticated route requires.
  let identity: AuthenticatedIdentity;
  let claims: Record<string, unknown>;
  if (route.public === true) {
    identity = PUBLIC_IDENTITY;
    claims = {};
  } else {
    const token = bearerToken(request);
    const authContext: AuthenticatedContext | null =
      token === null
        ? null
        : isClaimsAuthenticator(deps.authenticator)
          ? await deps.authenticator.verifyWithClaims(token)
          : await deps.authenticator
              .verify(token)
              .then((p) => (p === null ? null : { principal: p, claims: {} }));
    if (authContext === null) {
      throw new AuthenticationError();
    }
    identity = authContext.principal;
    claims = authContext.claims;
  }

  // 2. Tenant-resolution-first (ADR-0008): nothing below runs tenant-less, public routes included
  //    (a storefront read is still scoped to one merchant's catalog via `x-tenant-id`).
  const tenantId = resolveTenant(deps.tenantResolvers, {
    headers: request.headers as Record<string, string | undefined>,
    hostname: request.hostname,
    principal: identity,
    claims,
  });
  if (tenantId === null) {
    throw new AuthorizationError("No tenant resolved for this request");
  }
  request.tenantId = tenantId;

  // The identity is bound to the RESOLVED tenant exactly once, here — never defaulted. Everything
  // downstream (guard, authorization cache key, audit record, handlers) sees a tenant-scoped principal.
  const principal: Principal = { ...identity, tenantId };
  request.principal = principal;

  // 3. Authorize through the single policy engine (the app injects AdminGuard, or — when zero-trust
  //    enforcement is enabled, P2.0.2 — SecurityPermissionGuard). Skipped entirely for a `public`
  //    route: there is no real principal for a policy engine to decide about, and running one
  //    against the fixed public principal would only ever produce one hardcoded answer that a guard
  //    implementation could just as easily get wrong (e.g. an AllowAll default silently "deciding"
  //    a permission that was never actually checked).
  if (route.public !== true) {
    const sessionId = sessionClaim(claims);
    const userAgent = request.headers["user-agent"];
    const deviceHeader = request.headers["x-device-id"];
    const deviceRef = Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader;
    const guardContext: GuardRequestContext = {
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(request.ip !== undefined ? { ip: request.ip } : {}),
      ...(userAgent !== undefined ? { userAgent } : {}),
      ...(deviceRef !== undefined ? { deviceRef } : {}),
      tenantId,
    };
    const denied = await deps.guard.ensure(principal, route.permission, guardContext);
    if (denied !== null) {
      return denied;
    }
  }

  // 4. Rate limit. Per (tenant, principal) bucket for authenticated routes — port throws on infra
  //    failure and this surface fails CLOSED (admin/API tier; doc 14 §3). A `public` route buckets
  //    per (tenant, caller IP) instead: every anonymous visitor shares the same fixed principal id,
  //    so a per-principal bucket would let one visitor's traffic throttle every other visitor of the
  //    same storefront.
  const rateLimitKey =
    route.public === true
      ? `rl:${tenantId}:public:${request.ip}`
      : `rl:${tenantId}:${principal.id}`;
  let decision: RateLimitDecision;
  try {
    decision = await deps.rateLimiter.consume(
      rateLimitKey,
      deps.rateLimit.limit,
      deps.rateLimit.windowMs,
    );
  } catch (error) {
    // H-02 (audit): previously uncaught — a transient broker failure (Redis down) fell straight
    // through to `mapError`'s UNEXPECTED catch-all, a bare 500 in ~1-2ms, for EVERY route
    // including anonymous storefront reads that carry no admin/credential risk this port's own
    // fail-closed contract exists to protect. The admin/API tier still fails closed (doc 14 §3's
    // policy, now an honest 503 + Retry-After instead of an opaque 500); a `public` route instead
    // degrades to a per-instance in-memory limiter — weaker than the real port (no cross-instance
    // memory), so it runs at a fraction of the route's configured limit, not the full one.
    const reason = error instanceof Error ? error.message : String(error);
    if (route.public !== true) {
      deps.logger.error("rate limiter unavailable; failing closed", {
        requestId: request.requestId,
        route: route.path,
        error: reason,
      });
      return {
        status: 503,
        body: {
          code: "UNAVAILABLE",
          message: "Service temporarily unavailable",
          retryable: true,
          fields: [],
          retryAfterMs: 5_000,
        },
        headers: { "retry-after": String(retryAfterSeconds(5_000)) },
      };
    }
    deps.logger.warn("rate limiter unavailable; public route degraded to in-process limiting", {
      requestId: request.requestId,
      route: route.path,
      error: reason,
    });
    decision = await degradedLimiterFor(deps).consume(
      rateLimitKey,
      Math.max(1, Math.floor(deps.rateLimit.limit * DEGRADED_LIMIT_FACTOR)),
      deps.rateLimit.windowMs,
    );
  }
  if (!decision.allowed) {
    return {
      status: 429,
      body: {
        code: "RATE_LIMITED",
        message: "Rate limit exceeded",
        retryable: true,
        fields: [],
        retryAfterMs: decision.retryAfterMs,
      },
      headers: { "retry-after": String(retryAfterSeconds(decision.retryAfterMs)) },
    };
  }

  // 5. Validate at the boundary (zod); domain validation stays in the domain.
  const body = parseWith(route.schema.body, request.body, "body");
  const params = parseWith(route.schema.params, request.params, "params");
  const query = parseWith(route.schema.querystring, request.query, "querystring");

  const context: RequestContext = {
    tenantId,
    principal,
    requestId: request.requestId,
    correlationId: request.correlationId,
    ...(request.rawBody !== undefined ? { rawBody: new Uint8Array(request.rawBody) } : {}),
    headers: request.headers,
  };

  // 6. Idempotency for unsafe methods (claim → execute → snapshot; duplicates replay).
  const idempotencyKey = header(request, "idempotency-key");
  if (route.idempotent === true && idempotencyKey !== null) {
    const cacheKey = `tenant:${tenantId}:idem:${idempotencyKey}`;
    const replay = await deps.responseCache.get<ReplaySnapshot>(cacheKey);
    if (replay !== null) {
      return { status: replay.status, body: replay.body };
    }
    const claim = await deps.idempotencyKeys.claim(cacheKey, IDEMPOTENCY_TTL_SECONDS);
    if (claim === null) {
      return {
        status: 409,
        body: {
          code: "CONFLICT",
          message: "A request with this Idempotency-Key is already in flight",
          retryable: true,
          fields: [],
        },
      };
    }
    try {
      const response = await route.handle({ body, params, query, context });
      await deps.responseCache.set<ReplaySnapshot>(
        cacheKey,
        { status: response.status, body: response.body },
        IDEMPOTENCY_TTL_SECONDS,
      );
      return response;
    } catch (error) {
      await claim.release(); // failed execution frees the client's retry path
      throw error;
    }
  }

  return route.handle({ body, params, query, context });
}

function registerOperationalEndpoints(
  app: FastifyInstance,
  deps: HttpServerDeps,
  startedAt: number,
): void {
  app.get("/healthz", () => ({ status: "ok" })); // liveness: the process responds
  app.get("/readyz", async (_request, reply) => {
    const report = await deps.health.run();
    // H2-7: previously never called on the API's HTTP surface — `runtime_ready`/
    // `runtime_dependency_up` were populated for the worker/scheduler (health-server.ts) but never
    // for the tier that serves customer traffic, leaving RuntimeNotReady/DependencyDown blind to it.
    deps.metrics?.updateHealth?.(report);
    // H-04 (audit): the full report — verified live to include the database host, port, and the
    // driver's literal connection-failure text for an unauthenticated caller — is now opt-in
    // (`readinessDetail: "full"`, see that field's own doc comment); the status code below is
    // unaffected either way, so a kubelet/load-balancer probe's actual behavior never changes.
    const body = deps.readinessDetail === "full" ? report : { status: report.status };
    return reply.status(report.status === "unhealthy" ? 503 : 200).send(body);
  });
  app.get("/metrics", async (_request, reply) => {
    const memory = process.memoryUsage();
    const lines = [
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${memory.rss}`,
      "# TYPE nodejs_heap_used_bytes gauge",
      `nodejs_heap_used_bytes ${memory.heapUsed}`,
    ];
    // F5: append the injected HTTP metrics (request counts + durations), when present.
    const httpMetrics = deps.metrics?.renderHttp();
    const body = httpMetrics ? `${lines.join("\n")}\n${httpMetrics}\n` : `${lines.join("\n")}\n`;
    return reply.type("text/plain; version=0.0.4").send(body);
  });
}

function parseWith<T>(
  schema: { safeParse(input: unknown): unknown } | undefined,
  input: unknown,
  where: string,
): T {
  if (schema === undefined) return undefined as T;
  const result = (
    schema as {
      safeParse(i: unknown): {
        success: boolean;
        data?: T;
        error?: { issues: { path: (string | number)[]; message: string }[] };
      };
    }
  ).safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      `Invalid request ${where}`,
      (result.error?.issues ?? []).map((issue) => ({
        field: issue.path.join(".") || where,
        message: issue.message,
      })),
    );
  }
  return result.data as T;
}

function isClaimsAuthenticator(a: Authenticator): a is ClaimsAuthenticator {
  return (
    "verifyWithClaims" in a && typeof (a as ClaimsAuthenticator).verifyWithClaims === "function"
  );
}

function bearerToken(request: FastifyRequest): string | null {
  const value = header(request, "authorization");
  if (value === null || !value.toLowerCase().startsWith("bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Baseline security-headers layer (Phase 9 hardening — this transport shipped with none). Applied
 * to every response. `Content-Security-Policy` is scoped to the pure-JSON `/api/v*` surface only —
 * completely safe there, since a JSON response never executes a script or loads a resource, so a
 * strict `default-src 'none'` cannot break anything — and deliberately left unset for `/docs`
 * (Swagger UI needs its own inline scripts/styles) and `/admin` (the frozen HTML prototype), so
 * this can never be the thing that silently breaks either.
 */
function applySecurityHeaders(request: FastifyRequest, reply: FastifyReply): void {
  void reply.header("x-content-type-options", "nosniff");
  void reply.header("x-frame-options", "DENY");
  void reply.header("referrer-policy", "no-referrer");
  void reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  if (request.url.startsWith("/api/v")) {
    void reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  }
}

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value.length > 0) return value[0] ?? null;
  return null;
}

/** Fastify wraps some errors (404 route, body parse) — normalize to domain errors. */
function normalizeFastifyError(error: unknown): unknown {
  const statusCode = (error as { statusCode?: number }).statusCode;
  if (statusCode === 400) {
    return new ValidationError("Malformed request", [
      { field: "body", message: (error as Error).message },
    ]);
  }
  return error;
}

/**
 * The session id claim carries different names across identity providers: OIDC convention is `sid`,
 * but `KratosSessionAuthenticator` (`packages/auth/src/kratos.ts`) produces `session_id` (P2.0.3).
 * Reading only `sid` silently resolved to `undefined` under Kratos, denying every human once
 * zero-trust enforcement is on. Read under either name so the guard's session gate actually works
 * regardless of which claims-producing authenticator the runtime is composed with.
 */
function sessionClaim(claims: Record<string, unknown>): string | undefined {
  for (const key of ["sid", "session_id"]) {
    const value = claims[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
