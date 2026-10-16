import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  Authenticator,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  AuthenticatedIdentity,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { createAdminHttpApi } from "./server";

/**
 * C2-6: every wireX({ prisma, tenantId }) branch pins its repositories to ONE tenantId at
 * construction (ADR-0008), never per request. Before this guard, a caller could send any
 * x-tenant-id header and still be routed to the pinned tenant's repositories -- a silent
 * cross-tenant leak the moment a deployment carries a `tenantId` (i.e. runs Prisma-backed).
 * This proves the guard: a request tenant that does not match the pinned one is rejected exactly
 * like an unresolved tenant (403, "No tenant resolved"), not silently allowed through.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-07-05T00:00:00.000Z") };
const PINNED_TENANT = "tenant-pinned";

function fakes() {
  const cacheStore = new Map<string, unknown>();
  const claims = new Set<string>();
  const cache: Cache = {
    get: async <T>(k: string) => (cacheStore.get(k) as T | undefined) ?? null,
    set: async (k, v) => void cacheStore.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void cacheStore.delete(k),
    has: async (k) => cacheStore.has(k),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: Authenticator = {
    verify: async (token) => (token === "good" ? staff : null),
  };
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() + `-${(n += 1)}` };
  return { cache, idempotencyKeys, rateLimiter, authenticator, idGenerator };
}

describe("Admin HTTP tenant guard (C2-6, pinned-tenant composition)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const f = fakes();
    // tenantId present, prisma absent — same shape a Prisma-backed deployment carries (api.ts
    // always passes tenantId), without needing a live Postgres for this HTTP-layer assertion.
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
      tenantId: PINNED_TENANT,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("resolves the tenant when the header matches the one every repository was pinned to", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      headers: { authorization: "Bearer good", "x-tenant-id": PINNED_TENANT },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects a request tenant that does not match the pinned tenant (would otherwise read/write the wrong tenant's rows)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      headers: { authorization: "Bearer good", "x-tenant-id": "some-other-tenant" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/no tenant resolved/i);
  });

  it("rejects a request with no tenant header at all, same as before this guard existed", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      headers: { authorization: "Bearer good" },
    });
    expect(res.statusCode).toBe(403);
  });
});
