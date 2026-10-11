import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Authenticator, AuthenticatedIdentity, RateLimiter } from "@platform/contracts";
import { HealthRegistry } from "@platform/health";
import type { Logger } from "@platform/utils";
import { createHttpServer, registerRoutes, type HttpServerDeps } from "./server";
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

const seen: { bytes: number[]; contentType: unknown }[] = [];
let denied = false;

async function buildServer(): Promise<FastifyInstance> {
  const deps: HttpServerDeps = {
    logger: silentLogger(),
    idGenerator: { generate: () => crypto.randomUUID() },
    authenticator: {
      verify: async (token) => (token === "good" ? staff : null),
    } satisfies Authenticator,
    guard: {
      ensure: async () =>
        denied
          ? {
              status: 403,
              body: { code: "FORBIDDEN", message: "no", retryable: false, fields: [] },
            }
          : null,
    },
    tenantResolvers: [headerTenantResolver],
    rateLimiter: {
      consume: async () => ({ allowed: true, remaining: 9, retryAfterMs: 0 }),
    } satisfies RateLimiter,
    rateLimit: { limit: 100, windowMs: 60_000 },
    idempotencyKeys: { claim: async () => null },
    responseCache: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      has: async () => false,
    },
    health: new HealthRegistry(),
    api: { title: "t", description: "t" },
  };
  const app = createHttpServer(deps);
  await registerRoutes(app, deps, [
    defineRoute({
      method: "POST",
      path: "/uploads",
      version: 1,
      permission: "products:update",
      summary: "Binary upload",
      binaryBody: { maxBytes: 16, contentTypes: ["image/png", "image/jpeg"] },
      schema: {},
      handle: async ({ context }) => {
        seen.push({
          bytes: [...(context.rawBody ?? [])],
          contentType: context.headers?.["content-type"],
        });
        return { status: 201, body: { received: context.rawBody?.length ?? 0 } };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/plain",
      version: 1,
      permission: "widgets:create",
      summary: "An ordinary JSON route",
      schema: {},
      handle: async () => ({ status: 200, body: { ok: true } }),
    }),
  ]);
  await app.ready();
  return app;
}

const headers = (contentType: string, token = "good") => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": "t-1",
  "content-type": contentType,
});

describe("binary body routes (Plan 2C-3 uploads)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildServer();
  });
  afterAll(async () => {
    await app.close();
  });

  it("hands the raw bytes and the content type to the handler", async () => {
    seen.length = 0;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: headers("image/png"),
      payload: Buffer.from([1, 2, 3, 4]),
    });
    expect(res.statusCode).toBe(201);
    expect(seen).toEqual([{ bytes: [1, 2, 3, 4], contentType: "image/png" }]);
  });

  it("answers 413 with a uniform envelope when the body is over the route's limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: headers("image/png"),
      payload: Buffer.alloc(17),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE", retryable: false });
  });

  it("answers 415 for a content type the route does not accept (an svg)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: headers("image/svg+xml"),
      payload: Buffer.from("<svg/>"),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("does not let any other route accept an image body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/plain",
      headers: headers("image/png"),
      payload: Buffer.from([1, 2, 3]),
    });
    expect(res.statusCode).toBe(415);
  });

  it("still authenticates before the handler runs", async () => {
    seen.length = 0;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: headers("image/png", "bad"),
      payload: Buffer.from([1]),
    });
    expect(res.statusCode).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("still enforces the route's permission before the handler runs", async () => {
    seen.length = 0;
    denied = true;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: headers("image/png"),
      payload: Buffer.from([1]),
    });
    denied = false;
    expect(res.statusCode).toBe(403);
    expect(seen).toHaveLength(0);
  });
});
