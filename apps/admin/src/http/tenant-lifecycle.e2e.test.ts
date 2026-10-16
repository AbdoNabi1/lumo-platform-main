import type {
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createAdminHttpApi, type AdminHttpDeps } from "./server";

/**
 * T10.6 through the real admin API under TENANT_MODE=multi: the operator (deployment / platform tenant,
 * ADR-0014 8f) provisions and suspends merchants; each merchant's own traffic is then gated by status.
 * A token is `op` (the operator) or `m:<tenantId>` (a staff member of that tenant).
 */
const PLATFORM = "tenant-local";
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };

function deps(): AdminHttpDeps {
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
  const authenticator: ClaimsAuthenticator = {
    verify: async () => staff,
    verifyWithClaims: async (token) => {
      const tenant = token === "op" ? PLATFORM : token.startsWith("m:") ? token.slice(2) : null;
      return tenant === null ? null : { principal: staff, claims: { tenant_id: tenant } };
    },
  };
  let n = 0;
  return {
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => `id-${(n += 1)}` },
    clock: { now: () => new Date("2026-09-26T00:00:00.000Z") },
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    tenantMode: "multi",
    tenantId: PLATFORM,
    knownSubjects: ["owner-1"],
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot() {
  const app = await createAdminHttpApi(deps());
  apps.push(app);
  const call = (token: string, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": crypto.randomUUID() },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const createMerchant = async (slug = "acme", owner?: string) => {
    const res = await call("op", "POST", "/tenants", {
      slug,
      name: slug,
      isolationTier: "pooled",
      ...(owner === undefined ? {} : { ownerExternalId: owner }),
    });
    return { res, id: (res.json() as { id: string }).id };
  };
  return { call, createMerchant };
}

describe("tenant lifecycle over HTTP (multi mode)", () => {
  it("provisions a store: the create response reports the security baseline, and it can be re-read", async () => {
    const { call, createMerchant } = await boot();
    const { res, id } = await createMerchant("acme", "owner-1");
    expect(res.statusCode).toBe(201);
    expect(res.json().provisioning).toMatchObject({ tenantId: id, complete: true, missing: [] });
    const again = await call("op", "GET", `/tenants/${id}/provisioning?owner=owner-1`);
    expect(again.statusCode).toBe(200);
    expect(again.json().complete).toBe(true);
  });

  it("a merchant with no security baseline is reported incomplete, not ready", async () => {
    const { call, createMerchant } = await boot();
    const { id } = await createMerchant("acme");
    // Ask about an owner who was never provisioned: the tenant is administrable by no one.
    const res = await call("op", "GET", `/tenants/${id}/provisioning?owner=owner-1`);
    expect(res.json().complete).toBe(false);
    expect(res.json().missing).toContain("owner-admin-role");
  });

  it("suspension takes effect immediately on this instance, identically for every write endpoint", async () => {
    const { call, createMerchant } = await boot();
    const { id } = await createMerchant();
    const m = `m:${id}`;
    expect((await call(m, "GET", "/orders")).statusCode).toBe(200); // warms the cache: 'active'
    expect((await call("op", "POST", `/tenants/${id}/suspend`)).statusCode).toBe(200);

    const a = await call(m, "POST", "/orders", {});
    const b = await call(m, "POST", "/products", {});
    expect(a.statusCode).toBe(403);
    expect(a.json()).toEqual(b.json());
    expect(a.json().code).toBe("TENANT_SUSPENDED");
    // Still allowed: reading its own data.
    expect((await call(m, "GET", "/orders")).statusCode).toBe(200);
  });

  it("reactivation restores service; cancellation refuses everything", async () => {
    const { call, createMerchant } = await boot();
    const { id } = await createMerchant();
    const m = `m:${id}`;
    await call("op", "POST", `/tenants/${id}/suspend`);
    await call("op", "POST", `/tenants/${id}/activate`);
    expect((await call(m, "GET", "/orders")).statusCode).toBe(200);
    await call("op", "POST", `/tenants/${id}/cancel`);
    const res = await call(m, "GET", "/orders");
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("TENANT_CANCELLED");
  });

  it("refuses a tenant that has no row at all", async () => {
    const { call } = await boot();
    const res = await call("m:ghost", "GET", "/orders");
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("TENANT_UNKNOWN");
  });

  it("the platform tenant cannot be suspended or cancelled, and keeps being served", async () => {
    const { call } = await boot();
    for (const action of ["suspend", "cancel"]) {
      const res = await call("op", "POST", `/tenants/${PLATFORM}/${action}`);
      expect(res.statusCode).toBe(409);
    }
    expect((await call("op", "GET", "/orders")).statusCode).toBe(200);
  });

  it("an ordinary tenant cannot use the operator routes (unchanged 8f pin)", async () => {
    const { call, createMerchant } = await boot();
    const { id } = await createMerchant();
    const res = await call(`m:${id}`, "POST", `/tenants/${id}/suspend`);
    expect(res.statusCode).toBe(403);
  });
});
