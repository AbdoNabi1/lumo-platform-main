import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Authenticator, Cache, IdempotencyKeyStore, RateLimiter } from "@platform/contracts";
import { HealthRegistry } from "@platform/health";
import type { Logger } from "@platform/utils";
import { createHttpServer, registerRoutes, type HttpServerDeps } from "./server";
import { defineRoute, type RequestContext, type RouteDefinition } from "./route";
import { headerTenantResolver } from "./tenant-resolution";
import type { TenantGate } from "./tenant-gate";

const PLATFORM = "platform-tenant";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
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
const rateLimiter: RateLimiter = {
  consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
};

interface Seen {
  contexts: RequestContext[];
  guardCalls: number;
  gateCalls: string[];
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot(options: {
  platformTenantId?: string | undefined;
  gate?: TenantGate;
  extraRoutes?: readonly RouteDefinition[];
}): Promise<{ app: FastifyInstance; seen: Seen }> {
  const seen: Seen = { contexts: [], guardCalls: 0, gateCalls: [] };
  const gate: TenantGate | undefined =
    options.gate === undefined
      ? undefined
      : {
          availability: async (tenantId) => {
            seen.gateCalls.push(tenantId);
            return options.gate!.availability(tenantId);
          },
        };
  const deps: HttpServerDeps = {
    logger: silent,
    idGenerator: { generate: () => crypto.randomUUID() },
    authenticator: { verify: async () => null } satisfies Authenticator,
    guard: {
      ensure: async () => {
        seen.guardCalls += 1;
        return null;
      },
    },
    tenantResolvers: [headerTenantResolver],
    ...(gate === undefined ? {} : { tenantGate: gate }),
    ...(options.platformTenantId === undefined
      ? {}
      : { platformTenantId: options.platformTenantId }),
    rateLimiter,
    rateLimit: { limit: 100, windowMs: 60_000 },
    idempotencyKeys,
    responseCache: cache,
    health: new HealthRegistry(),
    api: { title: "t", description: "t" },
  };
  const app = createHttpServer(deps);
  const challenge = defineRoute({
    method: "GET",
    path: "/public/ingress",
    version: 1,
    permission: "outreach:record_webhook",
    public: true,
    tenantScope: "platform",
    idempotent: false,
    summary: "platform-scoped ingress",
    schema: { querystring: z.object({ "hub.challenge": z.string().optional() }).passthrough() },
    handle: async ({ query, context }) => {
      seen.contexts.push(context);
      return {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: query["hub.challenge"] ?? "none",
      };
    },
  });
  const post = defineRoute({
    method: "POST",
    path: "/public/ingress",
    version: 1,
    permission: "outreach:record_webhook",
    public: true,
    tenantScope: "platform",
    idempotent: false,
    summary: "platform-scoped ingress POST",
    schema: { body: z.unknown() },
    handle: async ({ context }) => {
      seen.contexts.push(context);
      return { status: 200, body: { received: true, bytes: context.rawBody?.byteLength ?? 0 } };
    },
  });
  const requestScoped = defineRoute({
    method: "GET",
    path: "/public/catalog",
    version: 1,
    permission: "products:read",
    public: true,
    summary: "an ordinary public route",
    schema: {},
    handle: async ({ context }) => {
      seen.contexts.push(context);
      return { status: 200, body: { tenant: context.tenantId } };
    },
  });
  await registerRoutes(app, deps, [challenge, post, requestScoped, ...(options.extraRoutes ?? [])]);
  await app.ready();
  apps.push(app);
  return { app, seen };
}

describe("tenantScope: platform (public ingress with no shop on the wire)", () => {
  it("reaches the handler with no auth and no x-tenant-id, as the platform tenant", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot({ platformTenantId: PLATFORM });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/public/ingress?hub.challenge=123456",
    });
    expect(res.statusCode).toBe(200);
    expect(seen.contexts.map((c) => c.tenantId)).toEqual([PLATFORM]);
    expect(seen.guardCalls).toBe(0);
  });

  it("forwards a handler's content-type and returns the raw string body (no JSON quoting)", async () => {
    expect.hasAssertions();
    const { app } = await boot({ platformTenantId: PLATFORM });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/public/ingress?hub.challenge=123456",
    });
    expect(res.body).toBe("123456");
    expect(res.headers["content-type"]).toContain("text/plain");
  });

  it("a forged x-tenant-id changes nothing: the handler still runs as the platform tenant", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot({ platformTenantId: PLATFORM });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/public/ingress",
      headers: { "content-type": "application/json", "x-tenant-id": "victim-shop" },
      payload: JSON.stringify({ a: 1 }),
    });
    expect(res.statusCode).toBe(200);
    expect(seen.contexts.map((c) => c.tenantId)).toEqual([PLATFORM]);
    expect(seen.contexts[0]?.rawBody?.byteLength).toBe(JSON.stringify({ a: 1 }).length);
  });

  it("the lifecycle gate is skipped: a cancelled shop's header cannot block ingestion", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot({
      platformTenantId: PLATFORM,
      gate: { availability: async () => "cancelled" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/public/ingress",
      headers: { "content-type": "application/json", "x-tenant-id": "cancelled-shop" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(200);
    expect(seen.gateCalls).toEqual([]);
  });

  it("an ordinary public route still requires tenant resolution and the lifecycle gate", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot({
      platformTenantId: PLATFORM,
      gate: { availability: async () => "cancelled" },
    });
    const noHeader = await app.inject({ method: "GET", url: "/api/v1/public/catalog" });
    expect(noHeader.statusCode).toBe(403);
    const cancelled = await app.inject({
      method: "GET",
      url: "/api/v1/public/catalog",
      headers: { "x-tenant-id": "cancelled-shop" },
    });
    expect(cancelled.statusCode).toBe(403);
    expect(cancelled.json<{ code: string }>().code).toBe("TENANT_CANCELLED");
    expect(seen.gateCalls).toEqual(["cancelled-shop"]);
    expect(seen.contexts).toEqual([]);
  });

  it("an ordinary public route keeps its own resolved tenant (unchanged behaviour)", async () => {
    expect.hasAssertions();
    const { app } = await boot({ platformTenantId: PLATFORM });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/public/catalog",
      headers: { "x-tenant-id": "shop-a" },
    });
    expect(res.json()).toEqual({ tenant: "shop-a" });
  });

  it("fails closed with 403 when no platform tenant is configured (or it is blank)", async () => {
    expect.hasAssertions();
    for (const platformTenantId of [undefined, ""]) {
      const { app, seen } = await boot({ platformTenantId });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/public/ingress?hub.challenge=1",
      });
      expect(res.statusCode).toBe(403);
      expect(seen.contexts).toEqual([]);
    }
  });

  it("refuses to register tenantScope platform on a non-public route", async () => {
    expect.hasAssertions();
    const bad = defineRoute({
      method: "GET",
      path: "/private",
      version: 1,
      permission: "products:read",
      tenantScope: "platform",
      summary: "bad",
      schema: {},
      handle: async () => ({ status: 200, body: {} }),
    });
    await expect(boot({ platformTenantId: PLATFORM, extraRoutes: [bad] })).rejects.toThrow(
      /requires public: true/,
    );
  });
});
