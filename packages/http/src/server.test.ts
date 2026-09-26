import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type {
  Authenticator,
  Cache,
  ClaimsAuthenticator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  AuthenticatedIdentity,
  Principal,
  RateLimiter,
} from "@platform/contracts";
import { HealthRegistry } from "@platform/health";
import type { Logger } from "@platform/utils";
import {
  createHttpServer,
  registerRoutes,
  type GuardRequestContext,
  type HttpMetricsSink,
  type HttpServerDeps,
} from "./server";
import { defineRoute } from "./route";
import { headerTenantResolver } from "./tenant-resolution";

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };

function silentLogger(): Logger {
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => log,
  };
  return log;
}

function fakeCache(): Cache {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T | undefined) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async has(key: string): Promise<boolean> {
      return store.has(key);
    },
  };
}

function fakeIdempotencyStore(): IdempotencyKeyStore {
  const claims = new Set<string>();
  return {
    async claim(key: string): Promise<IdempotencyClaim | null> {
      if (claims.has(key)) return null;
      claims.add(key);
      return {
        key,
        token: "t",
        release: async () => claims.delete(key),
      };
    },
  };
}

interface TestOverrides {
  readonly rateLimiter?: RateLimiter;
  readonly rateLimit?: { readonly limit: number; readonly windowMs: number };
  readonly exposeDocs?: boolean;
  readonly readinessDetail?: "full" | "status-only";
  readonly authenticator?: Authenticator | ClaimsAuthenticator;
  readonly denyPermissions?: boolean;
  /** Observes the request context the transport hands the guard (session/device/IP). */
  readonly onGuard?: (context?: GuardRequestContext) => void;
  /** Observes the principal the transport hands the guard (G-67: it must carry the tenant). */
  readonly onGuardPrincipal?: (principal: Principal) => void;
  /** Observes every rate-limiter key the transport consumes. */
  readonly onRateLimitKey?: (key: string) => void;
  readonly metrics?: HttpMetricsSink;
  readonly logger?: Logger;
  /** Registers a route whose handler throws, to exercise the 5xx error log. */
  readonly explode?: boolean;
}

let handled: unknown[] = [];
let guardCalls = 0;

async function buildServer(overrides: TestOverrides = {}): Promise<FastifyInstance> {
  const deps: HttpServerDeps = {
    logger: overrides.logger ?? silentLogger(),
    idGenerator: { generate: () => crypto.randomUUID() },
    authenticator:
      overrides.authenticator ??
      ({ verify: async (token) => (token === "good" ? staff : null) } satisfies Authenticator),
    guard: {
      ensure: async (principal, permission, context) => {
        guardCalls += 1;
        overrides.onGuardPrincipal?.(principal);
        overrides.onGuard?.(context);
        return overrides.denyPermissions === true
          ? {
              status: 403,
              body: {
                code: "FORBIDDEN",
                message: `Missing permission "${permission}"`,
                retryable: false,
                fields: [],
              },
            }
          : null;
      },
    },
    tenantResolvers: [headerTenantResolver],
    rateLimiter:
      overrides.rateLimiter ??
      ({
        consume: async (key: string) => {
          overrides.onRateLimitKey?.(key);
          return { allowed: true, remaining: 99, retryAfterMs: 0 };
        },
      } satisfies RateLimiter),
    rateLimit: overrides.rateLimit ?? { limit: 100, windowMs: 60_000 },
    idempotencyKeys: fakeIdempotencyStore(),
    responseCache: fakeCache(),
    health: new HealthRegistry(),
    api: { title: "Morbeh Admin API", description: "test" },
    ...(overrides.metrics === undefined ? {} : { metrics: overrides.metrics }),
    ...(overrides.exposeDocs === undefined ? {} : { exposeDocs: overrides.exposeDocs }),
    ...(overrides.readinessDetail === undefined
      ? {}
      : { readinessDetail: overrides.readinessDetail }),
  };

  const app = createHttpServer(deps);
  handled = [];
  guardCalls = 0;
  await registerRoutes(app, deps, [
    defineRoute({
      method: "POST",
      path: "/widgets",
      version: 1,
      permission: "widgets:create",
      idempotent: true,
      summary: "Create a widget",
      schema: {
        body: z.object({ name: z.string().min(1), quantity: z.number().int().positive() }),
      },
      handle: async ({ body, context }) => {
        handled.push({ body, tenantId: context.tenantId });
        return { status: 201, body: { id: "w-1", name: body.name } };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public-widgets",
      version: 1,
      permission: "widgets:read",
      public: true,
      summary: "Public: list widgets",
      schema: {},
      handle: async ({ context }) => {
        handled.push({ principal: context.principal, tenantId: context.tenantId });
        return { status: 200, body: { items: [] } };
      },
    }),
    ...(overrides.explode === true
      ? [
          defineRoute({
            method: "GET",
            path: "/boom",
            version: 1,
            permission: "widgets:read",
            summary: "Always fails",
            schema: {},
            handle: async () => {
              throw new Error("boom");
            },
          }),
        ]
      : []),
  ]);
  await app.ready();
  return app;
}

const good = {
  headers: {
    authorization: "Bearer good",
    "x-tenant-id": "t-1",
    "content-type": "application/json",
  },
};

describe("HTTP transport", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated requests with 401 + uniform envelope", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/widgets", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects tenant-less requests with 403 before any handler runs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/widgets",
      headers: { authorization: "Bearer good" },
      payload: { name: "a", quantity: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(handled).toHaveLength(0);
  });

  it("maps permission denial through the injected guard (single policy engine)", async () => {
    const denying = await buildServer({ denyPermissions: true });
    const res = await denying.inject({
      method: "POST",
      url: "/api/v1/widgets",
      ...good,
      payload: { name: "a", quantity: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("widgets:create");
    await denying.close();
  });

  // The zero-trust guard gates human principals on the session id, and the platform's two authenticators
  // name that claim differently (`sid` from a JWT, `session_id` from Kratos whoami). Reading only `sid`
  // silently dropped the Kratos case, denying every human once enforcement is on.
  it.each([
    ["sid", "sid-from-jwt"],
    ["session_id", "sid-from-kratos"],
  ])("passes the verified session id to the guard under the %s claim", async (claim, value) => {
    let seen: GuardRequestContext | undefined;
    const app = await buildServer({
      authenticator: {
        verify: async () => staff,
        verifyWithClaims: async () => ({ principal: staff, claims: { [claim]: value } }),
      },
      onGuard: (context) => {
        seen = context;
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/widgets",
      headers: { ...good.headers, "x-device-id": "device-9" },
      payload: { name: "a", quantity: 1 },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(seen?.sessionId).toBe(value);
    expect(seen?.deviceRef).toBe("device-9");
    await app.close();
  });

  it("returns 429 with retryAfterMs when the rate limiter denies", async () => {
    const limited = await buildServer({
      rateLimiter: { consume: async () => ({ allowed: false, remaining: 0, retryAfterMs: 1234 }) },
    });
    const res = await limited.inject({
      method: "POST",
      url: "/api/v1/widgets",
      ...good,
      payload: { name: "a", quantity: 1 },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 1234 });
    await limited.close();
  });

  describe("H-02 (audit): rate limiter infrastructure failure", () => {
    const throwingLimiter: RateLimiter = {
      consume: async () => {
        throw new Error("ECONNREFUSED (simulated Redis outage)");
      },
    };

    it("a protected route fails CLOSED with 503 + Retry-After, never the bare 500 it used to fall through to", async () => {
      const degraded = await buildServer({ rateLimiter: throwingLimiter });
      const res = await degraded.inject({
        method: "POST",
        url: "/api/v1/widgets",
        ...good,
        payload: { name: "a", quantity: 1 },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
      expect(res.json().retryAfterMs).toBeGreaterThan(0);
      // G0-3 (launch-readiness review): retryAfterMs alone lived only in the JSON body — no proxy,
      // HTTP client, or SDK backs off on a body field; they all read the standard header.
      expect(res.headers["retry-after"]).toBe("5");
      await degraded.close();
    });

    it("a public route degrades to in-process limiting instead of failing closed — the request still succeeds", async () => {
      const degraded = await buildServer({ rateLimiter: throwingLimiter });
      const res = await degraded.inject({
        method: "GET",
        url: "/api/v1/public-widgets",
        headers: { "x-tenant-id": "t-1" },
      });
      expect(res.statusCode).toBe(200);
      await degraded.close();
    });

    it("the degraded in-process limiter still enforces a cap (at a fraction of the configured limit), just per-instance instead of per-cluster", async () => {
      const degraded = await buildServer({
        rateLimiter: throwingLimiter,
        rateLimit: { limit: 4, windowMs: 60_000 }, // degraded cap = floor(4 * 0.5) = 2
      });
      const results = [];
      for (let i = 0; i < 3; i += 1) {
        results.push(
          (
            await degraded.inject({
              method: "GET",
              url: "/api/v1/public-widgets",
              headers: { "x-tenant-id": "t-1" },
            })
          ).statusCode,
        );
      }
      expect(results).toEqual([200, 200, 429]);
      await degraded.close();
    });

    it("a 429 from the primary (non-degraded) limiter also carries Retry-After, derived from the limiter's own decision (G0-3)", async () => {
      const blockingLimiter: RateLimiter = {
        consume: async () => ({ allowed: false, remaining: 0, retryAfterMs: 12_345 }),
      };
      const limited = await buildServer({ rateLimiter: blockingLimiter });
      const res = await limited.inject({
        method: "GET",
        url: "/api/v1/public-widgets",
        headers: { "x-tenant-id": "t-1" },
      });
      expect(res.statusCode).toBe(429);
      // Math.ceil(12_345 / 1_000) — rounds up so a caller never retries before the window resets.
      expect(res.headers["retry-after"]).toBe("13");
      await limited.close();
    });
  });

  it("zod-validates the body and returns 422 with field issues", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/widgets",
      ...good,
      payload: { name: "", quantity: -2 },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("VALIDATION");
    expect(body.fields.map((f: { field: string }) => f.field)).toEqual(
      expect.arrayContaining(["name", "quantity"]),
    );
  });

  it("handles the happy path with tenant context and echoes request/correlation ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/widgets",
      headers: { ...good.headers, "x-correlation-id": "corr-42" },
      payload: { name: "Wagon", quantity: 2 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers["x-correlation-id"]).toBe("corr-42");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(handled.at(-1)).toMatchObject({ tenantId: "t-1", body: { name: "Wagon" } });
  });

  it("replays the first response for a repeated Idempotency-Key (safe replay)", async () => {
    const key = crypto.randomUUID();
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/widgets",
      headers: { ...good.headers, "idempotency-key": key },
      payload: { name: "Once", quantity: 1 },
    });
    const before = handled.length;
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/widgets",
      headers: { ...good.headers, "idempotency-key": key },
      payload: { name: "Once", quantity: 1 },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(handled.length).toBe(before); // handler did NOT run again
  });

  it("serves liveness, readiness, and Prometheus-format process metrics", async () => {
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    const ready = await app.inject({ url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: "healthy" });
    const metrics = await app.inject({ url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("process_uptime_seconds");
  });

  it("H2-7: calls metrics.updateHealth() with each /readyz report, when a metrics sink is injected", async () => {
    const reports: unknown[] = [];
    const metrics: HttpMetricsSink = {
      recordHttp: () => {},
      renderHttp: () => "",
      updateHealth: (report) => reports.push(report),
    };
    const withMetrics = await buildServer({ metrics });

    await withMetrics.inject({ url: "/readyz" });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ status: "healthy" });
    await withMetrics.close();
  });

  it("H2-7: /readyz does not throw when the injected metrics sink has no updateHealth (optional, backward-compatible)", async () => {
    const metrics: HttpMetricsSink = { recordHttp: () => {}, renderHttp: () => "" };
    const withMetrics = await buildServer({ metrics });

    const ready = await withMetrics.inject({ url: "/readyz" });

    expect(ready.statusCode).toBe(200);
    await withMetrics.close();
  });

  describe("security headers (Phase 9 hardening — this transport shipped with none)", () => {
    it("sets nosniff/frame-options/referrer-policy/HSTS on every response, API and operational alike", async () => {
      for (const url of ["/api/v1/public-widgets", "/healthz"]) {
        const res = await app.inject({ method: "GET", url, headers: { "x-tenant-id": "t-1" } });
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-frame-options"]).toBe("DENY");
        expect(res.headers["referrer-policy"]).toBe("no-referrer");
        expect(res.headers["strict-transport-security"]).toContain("max-age=");
      }
    });

    it("scopes a strict Content-Security-Policy to the JSON API surface only", async () => {
      const apiRes = await app.inject({
        method: "GET",
        url: "/api/v1/public-widgets",
        headers: { "x-tenant-id": "t-1" },
      });
      expect(apiRes.headers["content-security-policy"]).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );

      const healthRes = await app.inject({ method: "GET", url: "/healthz" });
      expect(healthRes.headers["content-security-policy"]).toBeUndefined();
    });
  });

  describe("principal tenant binding (G-67)", () => {
    it("hands the guard a principal bound to the resolved tenant, not the identity's own", async () => {
      const seen: Principal[] = [];
      const bound = await buildServer({ onGuardPrincipal: (p) => seen.push(p) });
      await bound.inject({
        method: "POST",
        url: "/api/v1/widgets",
        headers: { ...good.headers, "x-tenant-id": "t-9" },
        payload: { name: "a", quantity: 1 },
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id: "staff-1", tenantId: "t-9" });
      await bound.close();
    });

    it("hands the guard's request context the RESOLVED tenant too (a guard that reads context, not principal)", async () => {
      // A zero-trust guard (SecurityPermissionGuard) evaluates on `context.tenantId`, not on the
      // principal; a context that carried a default here would authorise tenant B as tenant A.
      const contexts: Array<GuardRequestContext | undefined> = [];
      const bound = await buildServer({ onGuard: (c) => contexts.push(c) });
      for (const tenant of ["t-9", "t-10"]) {
        await bound.inject({
          method: "POST",
          url: "/api/v1/widgets",
          headers: { ...good.headers, "x-tenant-id": tenant },
          payload: { name: "a", quantity: 1 },
        });
      }
      expect(contexts.map((c) => c?.tenantId)).toEqual(["t-9", "t-10"]);
      await bound.close();
    });
  });

  describe("public routes (Phase 9 hardening — storefront reads)", () => {
    it("accepts anonymous requests with no Authorization header and still resolves a tenant", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/public-widgets",
        headers: { "x-tenant-id": "t-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(handled.at(-1)).toMatchObject({
        tenantId: "t-1",
        principal: { id: "public", kind: "customer", roles: [] },
      });
    });

    it("binds the anonymous principal to the tenant the request resolved to (G-67)", async () => {
      // The public principal has no tenant of its own; it must carry the storefront request's tenant,
      // per request, so a decision or audit made "as public" can never be attributed to another tenant.
      for (const tenant of ["t-a", "t-b"]) {
        await app.inject({
          method: "GET",
          url: "/api/v1/public-widgets",
          headers: { "x-tenant-id": tenant },
        });
        expect(handled.at(-1)).toMatchObject({
          tenantId: tenant,
          principal: { id: "public", tenantId: tenant },
        });
      }
    });

    it("never calls the permission guard for a public route", async () => {
      const before = guardCalls;
      await app.inject({
        method: "GET",
        url: "/api/v1/public-widgets",
        headers: { "x-tenant-id": "t-1" },
      });
      expect(guardCalls).toBe(before);
    });

    it("still 403s when no tenant can be resolved (public does not skip tenant resolution)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/public-widgets" });
      expect(res.statusCode).toBe(403);
    });

    it("rate-limits per (tenant, caller IP), never per the shared public principal id", async () => {
      const keys: string[] = [];
      const app2 = await buildServer({ onRateLimitKey: (key) => keys.push(key) });
      await app2.inject({
        method: "GET",
        url: "/api/v1/public-widgets",
        headers: { "x-tenant-id": "t-1" },
      });
      expect(keys.at(-1)).toMatch(/^rl:t-1:public:/);
      expect(keys.at(-1)).not.toContain(":public:public"); // never keyed by the shared principal id
      await app2.close();
    });

    it("omits bearerAuth from the OpenAPI security requirement for a public route", async () => {
      const withDocs = await buildServer({ exposeDocs: true });
      const res = await withDocs.inject({ url: "/openapi.json" });
      const spec = res.json();
      expect(spec.paths["/api/v1/public-widgets"].get.security).toEqual([]);
      expect(spec.paths["/api/v1/widgets"].post.security).toEqual([{ bearerAuth: [] }]);
      await withDocs.close();
    });
  });

  it("generates OpenAPI from the SAME zod schemas that validate (spec cannot drift)", async () => {
    const withDocs = await buildServer({ exposeDocs: true });
    const res = await withDocs.inject({ url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    const operation = spec.paths["/api/v1/widgets"].post;
    expect(operation.summary).toBe("Create a widget");
    expect(operation.requestBody.content["application/json"].schema.required).toEqual(
      expect.arrayContaining(["name", "quantity"]),
    );
    expect(spec.info.title).toBe("Morbeh Admin API");
    await withDocs.close();
  });

  describe("H-04 (audit): /docs, /openapi.json, and /readyz detail default to off", () => {
    it("/openapi.json and /docs are not registered at all unless exposeDocs: true is passed", async () => {
      expect((await app.inject({ url: "/openapi.json" })).statusCode).toBe(404);
      expect((await app.inject({ url: "/docs" })).statusCode).toBe(404);
    });

    it("/readyz reports only the top-level status by default — no dependency host/port/error text", async () => {
      const res = await app.inject({ url: "/readyz" });
      expect(res.json()).toEqual({ status: expect.any(String) });
    });

    it('/readyz reports the full HealthRegistry detail when readinessDetail: "full" is passed', async () => {
      const full = await buildServer({ readinessDetail: "full" });
      const res = await full.inject({ url: "/readyz" });
      const body = res.json();
      expect(body).toHaveProperty("checkedAt");
      expect(body).toHaveProperty("components");
      await full.close();
    });

    it("the /readyz status CODE (200/503) is identical either way — only the body detail changes", async () => {
      const failingHealth = new HealthRegistry();
      failingHealth.register({
        name: "dep",
        probe: async () => {
          throw new Error("simulated dependency failure");
        },
      });
      const statusOnly = createHttpServer({
        logger: silentLogger(),
        idGenerator: { generate: () => crypto.randomUUID() },
        authenticator: { verify: async () => null },
        guard: { ensure: async () => null },
        tenantResolvers: [headerTenantResolver],
        rateLimiter: { consume: async () => ({ allowed: true, remaining: 1, retryAfterMs: 0 }) },
        rateLimit: { limit: 100, windowMs: 60_000 },
        idempotencyKeys: fakeIdempotencyStore(),
        responseCache: fakeCache(),
        health: failingHealth,
        api: { title: "t", description: "t" },
      });
      await statusOnly.ready();
      const res = await statusOnly.inject({ url: "/readyz" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "unhealthy" });
      await statusOnly.close();
    });
  });
});

describe("HTTP transport — log lines name the tenant (T10.7)", () => {
  function recordingLogger(): {
    readonly logger: Logger;
    readonly lines: { message: string; fields: Record<string, unknown> }[];
  } {
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const record = (message: string, fields?: Record<string, unknown>): void => {
      lines.push({ message, fields: fields ?? {} });
    };
    const logger: Logger = {
      debug: record,
      info: record,
      warn: record,
      error: record,
      child: () => logger,
    };
    return { logger, lines };
  }

  it("a 5xx failure line carries the tenant the request resolved to, and never another's", async () => {
    const { logger, lines } = recordingLogger();
    const app = await buildServer({ logger, explode: true });
    try {
      for (const tenant of ["t-1", "t-2"]) {
        const res = await app.inject({
          method: "GET",
          url: "/api/v1/boom",
          headers: { ...good.headers, "x-tenant-id": tenant },
        });
        expect(res.statusCode).toBe(500);
      }
    } finally {
      await app.close();
    }
    const failed = lines.filter((line) => line.message === "http request failed");
    expect(failed.map((line) => line.fields["tenantId"])).toEqual(["t-1", "t-2"]);
  });
});
