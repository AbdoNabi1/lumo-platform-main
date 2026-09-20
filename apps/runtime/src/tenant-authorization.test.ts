import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AccessControl,
  AuditEvent,
  AuditTrail,
  AuthenticatedContext,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  Permission,
  Principal,
  RateLimiter,
} from "@platform/contracts";
import { createAdminHttpApi } from "@platform/admin";
import { CachedAccessControl } from "@platform/auth";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";

/**
 * G-67 — authorization decisions were tenant-blind end to end. Driven through the REAL admin pipeline
 * (`createAdminHttpApi`, `tenantMode: "multi"`, the real `AdminGuard`) over a REAL
 * `CachedAccessControl` in ONE shared keyspace (Redis: `REDIS_KEY_PREFIX` is not per tenant). Only the
 * decision point behind the cache is a double, and it records every consultation.
 *
 * Each case fails for exactly one reason:
 *  - the decision cache serves tenant A's decision to tenant B (the inner decision point is consulted
 *    once for two tenants);
 *  - the audit record cannot say which tenant a decision was made for.
 * Neither asserts anything about the Keto tuple model — that is `keto-tenant-grants.test.ts` (G-70).
 */

const clock: Clock = { now: () => new Date("2026-09-20T00:00:00.000Z") };

/** The SAME principal id in two tenants: what a principal-only cache key would wrongly merge. */
const shared = { id: "svc-shared", kind: "staff", roles: ["admin"] } as const;
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: shared, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: shared, claims: { tenant_id: "tenant-b" } },
};

function fixture() {
  const kv = new Map<string, unknown>(); // ONE global keyspace
  const cache: Cache = {
    get: async <T>(k: string) => (kv.get(k) as T | undefined) ?? null,
    set: async (k, v) => void kv.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void kv.delete(k),
    has: async (k) => kv.has(k),
  };
  const consulted: Array<{ principal: Principal; permission: Permission }> = [];
  const inner: AccessControl = {
    authorize: async (principal, permission) => {
      consulted.push({ principal, permission });
      return true;
    },
  };
  const audited: AuditEvent[] = [];
  const auditTrail: AuditTrail = { record: async (event) => void audited.push(event) };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => sessions[token]?.principal ?? null,
    verifyWithClaims: async (token) => sessions[token] ?? null,
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => ({
      key,
      token: "t",
      release: async () => true,
    }),
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  return {
    consulted,
    audited,
    deps: {
      tenantMode: "multi" as const,
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => crypto.randomUUID() },
      clock,
      authenticator,
      rateLimiter,
      idempotencyKeys,
      // A distinct cache for HTTP responses so only the authz cache is under test.
      responseCache: {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
        has: async () => false,
      } satisfies Cache,
      accessControl: new CachedAccessControl(inner, cache, 30),
      auditTrail,
    },
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

const listOrders = (app: FastifyInstance, token: string) =>
  app.inject({
    method: "GET",
    url: "/api/v1/orders",
    headers: { authorization: `Bearer ${token}` },
  });

describe("G-67 — authorization decision cache and audit record are tenant-scoped", () => {
  it("consults the decision point once per tenant for the same principal and permission", async () => {
    const fx = fixture();
    const app = await createAdminHttpApi(fx.deps);
    apps.push(app);

    expect((await listOrders(app, "tok-a")).statusCode).toBe(200);
    expect((await listOrders(app, "tok-b")).statusCode).toBe(200);

    // Same principal id, same permission, two tenants: tenant B must not be served tenant A's cached
    // decision. Only the cache key can make this one — the inner double allows everything.
    expect(fx.consulted).toHaveLength(2);
  });

  it("records the tenant a decision was made for on the audit trail", async () => {
    const fx = fixture();
    const app = await createAdminHttpApi(fx.deps);
    apps.push(app);

    await listOrders(app, "tok-a");
    await listOrders(app, "tok-b");

    // Each request is audited at the transport AND again inside the controller (which is handed only
    // the principal, not the request context), so assert over every record, not a fixed count.
    expect(fx.audited.length).toBeGreaterThan(0);
    expect([...new Set(fx.audited.map((event) => event.tenantId))].sort()).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });
});
