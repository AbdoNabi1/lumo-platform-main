import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Authenticator, Cache, IdempotencyKeyStore, RateLimiter } from "@platform/contracts";
import { HealthRegistry } from "@platform/health";
import type { Logger } from "@platform/utils";
import { createHttpServer, registerRoutes, type HttpServerDeps } from "./server";
import { defineRoute, type RequestContext, type RouteDefinition } from "./route";
import { headerTenantResolver } from "./tenant-resolution";

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

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

interface Seen {
  raw: RequestContext[];
  ordinary: unknown[];
  bodies: unknown[];
}

async function boot(): Promise<{ app: FastifyInstance; seen: Seen }> {
  const seen: Seen = { raw: [], ordinary: [], bodies: [] };
  const deps: HttpServerDeps = {
    logger: silent,
    idGenerator: { generate: () => crypto.randomUUID() },
    authenticator: { verify: async () => null } satisfies Authenticator,
    guard: { ensure: async () => null },
    tenantResolvers: [headerTenantResolver],
    platformTenantId: "platform-tenant",
    rateLimiter,
    rateLimit: { limit: 100, windowMs: 60_000 },
    idempotencyKeys,
    responseCache: cache,
    health: new HealthRegistry(),
    api: { title: "t", description: "t" },
  };
  const app = createHttpServer(deps);
  const rawRoute = defineRoute({
    method: "POST",
    path: "/public/raw-ingress",
    version: 1,
    permission: "outreach:record_webhook",
    public: true,
    tenantScope: "platform",
    idempotent: false,
    rawJsonBody: true,
    summary: "signed ingress: the handler authenticates the bytes, then parses",
    schema: {},
    handle: async ({ body, context }) => {
      seen.raw.push(context);
      seen.bodies.push(body);
      return {
        status: 200,
        body: {
          bytes: context.rawBody?.byteLength ?? 0,
          text: new TextDecoder().decode(context.rawBody),
        },
      };
    },
  });
  const ordinary = defineRoute({
    method: "POST",
    path: "/public/ordinary",
    version: 1,
    permission: "outreach:record_webhook",
    public: true,
    tenantScope: "platform",
    idempotent: false,
    summary: "an ordinary JSON route",
    schema: { body: z.unknown() },
    handle: async ({ body }) => {
      seen.ordinary.push(body);
      return { status: 200, body: { echoed: body } };
    },
  });
  await registerRoutes(app, deps, [rawRoute, ordinary] as readonly RouteDefinition[]);
  await app.ready();
  apps.push(app);
  return { app, seen };
}

const post = (app: FastifyInstance, url: string, payload: string, type = "application/json") =>
  app.inject({ method: "POST", url: `/api/v1${url}`, headers: { "content-type": type }, payload });

describe("rawJsonBody: an encapsulated parser that leaves the bytes untouched", () => {
  it("malformed JSON reaches the handler as bytes (no parser error, no 400): the handler decides", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot();
    const res = await post(app, "/public/raw-ingress", "{ not json");
    expect(res.statusCode).toBe(200);
    expect(res.json<{ text: string }>().text).toBe("{ not json");
    expect(seen.bodies).toEqual([undefined]);
  });

  it("well-formed, non-canonical JSON arrives byte-for-byte and is NOT parsed by the transport", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot();
    const text = '{ "b" : 2,\n  "a":[ 1 , 2 ] }';
    const res = await post(app, "/public/raw-ingress", text);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ text: string; bytes: number }>()).toEqual({
      text,
      bytes: Buffer.byteLength(text),
    });
    expect(seen.bodies).toEqual([undefined]);
  });

  it("the other routes keep the shared parser: malformed JSON is refused before the handler", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot();
    const res = await post(app, "/public/ordinary", "{ not json");
    // whatever the shared parser/mapper answers for a malformed body today (unchanged here), it is not a success
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(seen.ordinary).toEqual([]);
    const good = await post(app, "/public/ordinary", '{"a":1}');
    expect(good.json()).toEqual({ echoed: { a: 1 } });
  });

  it("keeps the body limit: an oversized body is 413 on the raw route and the handler never runs", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot();
    const big = JSON.stringify({ pad: "x".repeat(1_100_000) });
    const res = await post(app, "/public/raw-ingress", big);
    expect(res.statusCode).toBe(413);
    expect(res.json<{ code: string }>().code).toBe("PAYLOAD_TOO_LARGE");
    expect(seen.raw).toEqual([]);
  });

  it("a non-JSON content type carries no raw bytes for the handler to authenticate", async () => {
    expect.hasAssertions();
    const { app, seen } = await boot();
    await post(app, "/public/raw-ingress", "plain", "text/plain");
    expect(seen.raw.map((context) => context.rawBody)).toEqual([undefined]);
  });
});
