import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuthenticatedIdentity, Cache, IdempotencyKeyStore } from "@platform/contracts";
import { HealthRegistry } from "@platform/health";
import type { Logger } from "@platform/utils";
import { createHttpServer, registerRoutes, type HttpServerDeps } from "./server";
import { defineRoute, type RouteDefinition } from "./route";
import { headerTenantResolver } from "./tenant-resolution";
import { suspendedTenantMayCall, type TenantAvailability, type TenantGate } from "./tenant-gate";

/**
 * T10.6: a tenant's lifecycle status is enforced ONCE, where the tenant is resolved
 * (`executeRoute`, before authorization) — not per feature. These tests drive the real pipeline.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};
const cache: Cache = {
  get: async () => null,
  set: async () => undefined,
  delete: async () => undefined,
  has: async () => false,
};
const idempotencyKeys: IdempotencyKeyStore = {
  claim: async (key) => ({ key, token: "t", release: async () => true }),
};

const ok = async () => ({ status: 200, body: { ok: true } });
const routes: readonly RouteDefinition[] = [
  defineRoute({
    method: "GET",
    path: "/orders",
    version: 1,
    permission: "orders:read",
    summary: "read",
    schema: {},
    handle: ok,
  }),
  defineRoute({
    method: "POST",
    path: "/orders",
    version: 1,
    permission: "orders:create",
    summary: "write",
    schema: {},
    handle: ok,
  }),
  defineRoute({
    method: "DELETE",
    path: "/products/x",
    version: 1,
    permission: "catalog:delete",
    summary: "other write",
    schema: {},
    handle: ok,
  }),
  defineRoute({
    method: "GET",
    path: "/storefront/catalog",
    version: 1,
    permission: "catalog:read",
    public: true,
    summary: "public read",
    schema: {},
    handle: ok,
  }),
  defineRoute({
    method: "POST",
    path: "/billing/invoices/pay",
    version: 1,
    permission: "billing:pay",
    allowWhenSuspended: true,
    summary: "pay overdue invoice",
    schema: {},
    handle: ok,
  }),
];

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot(gate: TenantGate | undefined) {
  const deps: HttpServerDeps = {
    logger: log,
    idGenerator: { generate: () => crypto.randomUUID() },
    authenticator: { verify: async (t) => (t === "good" ? staff : null) },
    guard: { ensure: async () => null },
    tenantResolvers: [headerTenantResolver],
    rateLimiter: { consume: async () => ({ allowed: true, remaining: 9, retryAfterMs: 0 }) },
    rateLimit: { limit: 10, windowMs: 1000 },
    idempotencyKeys,
    responseCache: cache,
    health: new HealthRegistry(),
    api: { title: "t", description: "t" },
    ...(gate === undefined ? {} : { tenantGate: gate }),
  };
  const app = createHttpServer(deps);
  await registerRoutes(app, deps, routes);
  await app.ready();
  apps.push(app);
  return app;
}

const gateOf = (map: Record<string, TenantAvailability>): TenantGate => ({
  availability: async (id) => map[id] ?? "unknown",
});
const call = (
  app: FastifyInstance,
  method: "GET" | "POST" | "DELETE",
  url: string,
  tenant: string,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: "Bearer good", "x-tenant-id": tenant },
  });

describe("tenant status gate (T10.6, Gap 1)", () => {
  it("refuses a suspended tenant's writes with the SAME refusal whichever endpoint is called", async () => {
    const app = await boot(gateOf({ "t-sus": "suspended" }));
    const a = await call(app, "POST", "/orders", "t-sus");
    const b = await call(app, "DELETE", "/products/x", "t-sus");
    expect(a.statusCode).toBe(403);
    expect(b.statusCode).toBe(403);
    expect(a.json()).toEqual(b.json());
    expect(a.json().code).toBe("TENANT_SUSPENDED");
  });

  it("refuses a suspended tenant's public storefront traffic (the store is closed)", async () => {
    const app = await boot(gateOf({ "t-sus": "suspended" }));
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/storefront/catalog",
      headers: { "x-tenant-id": "t-sus" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("TENANT_SUSPENDED");
  });

  it("still lets a suspended tenant read its own data and pay its invoice", async () => {
    const app = await boot(gateOf({ "t-sus": "suspended" }));
    expect((await call(app, "GET", "/orders", "t-sus")).statusCode).toBe(200);
    expect((await call(app, "POST", "/billing/invoices/pay", "t-sus")).statusCode).toBe(200);
  });

  it("refuses EVERYTHING for a cancelled tenant, reads and billing included", async () => {
    const app = await boot(gateOf({ "t-can": "cancelled" }));
    for (const [m, u] of [
      ["GET", "/orders"],
      ["POST", "/billing/invoices/pay"],
      ["POST", "/orders"],
    ] as const) {
      const res = await call(app, m, u, "t-can");
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("TENANT_CANCELLED");
    }
  });

  it("does not affect an active tenant, nor other tenants of the same process", async () => {
    const app = await boot(gateOf({ "t-sus": "suspended", "t-ok": "active" }));
    expect((await call(app, "POST", "/orders", "t-ok")).statusCode).toBe(200);
    expect((await call(app, "POST", "/orders", "t-sus")).statusCode).toBe(403);
  });

  it("refuses a tenant with no row (unknown) rather than serving it", async () => {
    const app = await boot(gateOf({}));
    const res = await call(app, "GET", "/orders", "t-ghost");
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("TENANT_UNKNOWN");
  });

  it("fails CLOSED when the status cannot be read — 503, retryable, handler never runs", async () => {
    const app = await boot({
      availability: async () => {
        throw new Error("db down");
      },
    });
    const res = await call(app, "GET", "/orders", "t-any");
    expect(res.statusCode).toBe(503);
    expect(res.json().retryable).toBe(true);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("is not applied when no gate is configured (single-tenant mode is unchanged)", async () => {
    const app = await boot(undefined);
    expect((await call(app, "POST", "/orders", "anything")).statusCode).toBe(200);
  });

  it("documents the allowed set explicitly: authenticated GETs and routes opting in — nothing else", () => {
    const by = (m: string, p: string) => routes.find((r) => r.method === m && r.path === p)!;
    expect(suspendedTenantMayCall(by("GET", "/orders"))).toBe(true);
    expect(suspendedTenantMayCall(by("POST", "/billing/invoices/pay"))).toBe(true);
    expect(suspendedTenantMayCall(by("POST", "/orders"))).toBe(false);
    expect(suspendedTenantMayCall(by("DELETE", "/products/x"))).toBe(false);
    expect(suspendedTenantMayCall(by("GET", "/storefront/catalog"))).toBe(false);
  });
});
