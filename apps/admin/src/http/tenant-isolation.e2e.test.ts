import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedContext,
  Cache,
  Clock,
  ClaimsAuthenticator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  AuthenticatedIdentity,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { createAdminHttpApi } from "./server";

/**
 * T10.5 — the transport-level adversarial cases, driven through the REAL admin pipeline
 * (`createAdminHttpApi` with `tenantMode: "multi"`, the real resolver chain, the real
 * `assertMultiTenantReady` boot check, the real route table). Only the infrastructure ports are
 * doubles, and they model Redis's defining property: ONE global keyspace shared by every tenant
 * (`REDIS_KEY_PREFIX` is `morbeh:`, not per tenant). So isolation here is whatever the caller put
 * in the key — delete `${tenantId}` from `server.ts`'s rate-limit, idempotency or response-cache key
 * and the corresponding case below goes red (proven by mutation; see the T10.5 report).
 *
 * Layer under test: application (transport + composition). No RLS, no Postgres.
 */

const clock: Clock = { now: () => new Date("2026-09-20T00:00:00.000Z") };

/** The SAME principal id in two tenants: what a per-principal-only key would wrongly merge. */
const shared = {
  id: "svc-shared",
  kind: "staff",
  roles: ["admin"],
} as const satisfies AuthenticatedIdentity;
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: shared, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: shared, claims: { tenant_id: "tenant-b" } },
  // Authenticated, but the token carries NO tenant claim.
  "tok-noclaim": { principal: { id: "svc-loose", kind: "staff", roles: ["admin"] }, claims: {} },
};

function infra() {
  const kv = new Map<string, unknown>(); // ONE keyspace for cache + idempotency + counters
  const cache: Cache = {
    get: async <T>(k: string) => (kv.get(`cache:${k}`) as T | undefined) ?? null,
    set: async (k, v) => void kv.set(`cache:${k}`, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void kv.delete(`cache:${k}`),
    has: async (k) => kv.has(`cache:${k}`),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (kv.has(`idem:${key}`)) return null;
      kv.set(`idem:${key}`, true);
      return { key, token: "t", release: async () => kv.delete(`idem:${key}`) };
    },
  };
  const consumed: string[] = [];
  const CAP = 2; // the double enforces its own small cap so the case can exhaust a bucket cheaply
  const rateLimiter: RateLimiter = {
    consume: async (key) => {
      consumed.push(key);
      const used = ((kv.get(`rl:${key}`) as number | undefined) ?? 0) + 1;
      kv.set(`rl:${key}`, used);
      return { allowed: used <= CAP, remaining: Math.max(0, CAP - used), retryAfterMs: 1_000 };
    },
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => sessions[token]?.principal ?? null,
    verifyWithClaims: async (token) => sessions[token] ?? null,
  };
  return { kv, cache, idempotencyKeys, rateLimiter, authenticator, consumed };
}

let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

describe("multi-tenant transport isolation (T10.5)", () => {
  let app: FastifyInstance;
  let fx: ReturnType<typeof infra>;

  // A fresh app + keyspace per test: buckets and idempotency claims must not leak BETWEEN cases.
  beforeEach(async () => {
    fx = infra();
    app = await createAdminHttpApi({
      tenantMode: "multi",
      tenantGate: { availability: async () => "active" as const }, // fixture tenants have no Tenant row (T10.6)
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
    });
  });
  afterEach(async () => {
    await app.close();
  });

  const bearer = (token: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...extra,
  });
  const createFolder = (token: string, name: string, extra: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1/media/folders",
      headers: bearer(token, extra),
      payload: { name },
    });
  const listFolders = async (token: string) => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/media/folders",
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { items: { name: string }[] }).items.map((f) => f.name);
  };

  // ── Case 2: a forged x-tenant-id does not override a verified claim ───────────────────────────
  describe("case 2 — forged x-tenant-id", () => {
    it("a verified tenant claim wins over a forged x-tenant-id header", async () => {
      const res = await createFolder("tok-a", "made-by-a", { "x-tenant-id": "tenant-b" });
      expect(res.statusCode).toBeLessThan(300);
      // It landed in A (the claim), not in B (the header) — observed through each tenant's own list.
      expect(await listFolders("tok-a")).toContain("made-by-a");
      expect(await listFolders("tok-b")).not.toContain("made-by-a");
    });

    /**
     * DECISION (T10.5): the `x-tenant-id` fallback does NOT survive for an authenticated principal.
     * Why: the header is client-controlled. If a verified token that merely lacks `tenant_id` may pick
     * its tenant by header, then ANY valid token (a customer token, another realm's service account)
     * can act inside ANY tenant simply by naming it — the claim protects nobody, it only ranks first.
     * A token with no tenant claim is a token bound to no tenant; the correct answer is "no tenant
     * resolved" (403), never "whichever tenant the caller asks for". The header remains valid where
     * there IS no verified principal — public storefront routes (below) — because those routes carry
     * no identity to protect and the tenant IS the request.
     */
    it("a token with NO tenant claim cannot pick a tenant by header (fallback removed)", async () => {
      const res = await createFolder("tok-noclaim", "sneaky", { "x-tenant-id": "tenant-b" });
      expect(res.statusCode).toBe(403);
      expect(await listFolders("tok-b")).not.toContain("sneaky");
    });

    it("a public route (no verified principal) still resolves the tenant from the header", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/public/products",
        headers: { "x-tenant-id": "tenant-a" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("a public route with no tenant at all is rejected, never defaulted", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/public/products" });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Case 6 (+ response cache, case 5): idempotency ────────────────────────────────────────────
  describe("case 6 — idempotency keys and the replay cache", () => {
    it("A's Idempotency-Key does not suppress or replay for B's identical request", async () => {
      const key = "idem-shared-1";
      const a1 = await createFolder("tok-a", "same-name", { "idempotency-key": key });
      const b1 = await createFolder("tok-b", "same-name", { "idempotency-key": key });

      expect(a1.statusCode).toBeLessThan(300);
      // Not a 409 "already in flight" from A's claim, and not A's response replayed from the cache.
      expect(b1.statusCode).toBeLessThan(300);
      expect(b1.json()).not.toEqual(a1.json());
      // Both tenants really executed it.
      expect(await listFolders("tok-a")).toContain("same-name");
      expect(await listFolders("tok-b")).toContain("same-name");
      // And the shared keyspace holds one tenant-scoped entry per tenant, never a bare key.
      const idemKeys = [...fx.kv.keys()].filter((k) => k.includes(key));
      expect(idemKeys.length).toBeGreaterThanOrEqual(2);
      expect(idemKeys.every((k) => /tenant:tenant-[ab]:idem:/.test(k))).toBe(true);
    });

    it("control: the SAME tenant replaying its own key IS deduplicated (so the case above can fail)", async () => {
      const key = "idem-own-1";
      const first = await createFolder("tok-a", "own-name", { "idempotency-key": key });
      const again = await createFolder("tok-a", "own-name", { "idempotency-key": key });
      expect(again.json()).toEqual(first.json());
    });
  });

  // ── Case 7: rate-limit buckets are not shared across tenants ──────────────────────────────────
  describe("case 7 — rate-limit buckets", () => {
    const publicGet = (tenant: string) =>
      app.inject({
        method: "GET",
        url: "/api/v1/public/products",
        headers: { "x-tenant-id": tenant },
        remoteAddress: "203.0.113.9", // the SAME caller IP against both tenants
      });

    it("exhausting a public bucket for A does not throttle B (same IP)", async () => {
      expect((await publicGet("tenant-a")).statusCode).toBe(200);
      expect((await publicGet("tenant-a")).statusCode).toBe(200);
      expect((await publicGet("tenant-a")).statusCode).toBe(429); // control: the limiter does bite
      expect((await publicGet("tenant-b")).statusCode).toBe(200);
    });

    it("exhausting an authenticated bucket for A does not throttle B (same principal id)", async () => {
      const authedGet = (token: string) =>
        app.inject({ method: "GET", url: "/api/v1/media/folders", headers: bearer(token) });
      // Distinct route from the prior tests' traffic is irrelevant: the bucket is per (tenant, principal).
      const before = fx.consumed.length;
      for (let i = 0; i < 6; i += 1) await authedGet("tok-a");
      expect((await authedGet("tok-a")).statusCode).toBe(429); // control
      expect((await authedGet("tok-b")).statusCode).toBe(200);
      const keys = fx.consumed.slice(before);
      expect(keys.some((k) => k === "rl:tenant-a:svc-shared")).toBe(true);
      expect(keys.some((k) => k === "rl:tenant-b:svc-shared")).toBe(true);
    });
  });
});
