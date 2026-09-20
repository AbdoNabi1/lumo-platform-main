import type {
  ClaimsAuthenticator,
  Cache,
  IdGenerator,
  IdempotencyKeyStore,
  Principal,
  RateLimiter,
} from "@platform/contracts";
import type { Database } from "@platform/db";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { defineRoute } from "@platform/http";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { pinRoutesToTenant } from "./tenancy-routes";
import { createAdminHttpApi, type AdminHttpDeps } from "./server";

const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock = { now: () => new Date("2026-09-19T00:00:00.000Z") };

function harness(claimTenant?: string) {
  const rateKeys: string[] = [];
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
    consume: async (key) => {
      rateKeys.push(key);
      return { allowed: true, remaining: 99, retryAfterMs: 0 };
    },
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => (token === "good" ? staff : null),
    verifyWithClaims: async (token) =>
      token === "good"
        ? { principal: staff, claims: claimTenant === undefined ? {} : { tenant_id: claimTenant } }
        : null,
  };
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
  const deps: AdminHttpDeps = {
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
  };
  return { deps, rateKeys };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot(deps: AdminHttpDeps) {
  const app = await createAdminHttpApi(deps);
  apps.push(app);
  return app;
}

const get = (app: FastifyInstance, headers: Record<string, string>) =>
  app.inject({ method: "GET", url: "/api/v1/orders", headers });

describe("createAdminHttpApi — TENANT_MODE=multi", () => {
  it("serves two different tenants through the same process, each scoped to its own id", async () => {
    // T10.5: the tenant comes from each caller's VERIFIED claim (a claim-less token no longer
    // resolves by header — see tenant-isolation.e2e.test.ts), so each tenant is its own token.
    const a = harness("t-a");
    const b = harness("t-b");
    const appA = await boot({ ...a.deps, tenantMode: "multi" });
    const appB = await boot({ ...b.deps, tenantMode: "multi" });
    expect((await get(appA, { authorization: "Bearer good" })).statusCode).toBe(200);
    expect((await get(appB, { authorization: "Bearer good" })).statusCode).toBe(200);
    expect(a.rateKeys.some((k) => k.startsWith("rl:t-a:"))).toBe(true);
    expect(b.rateKeys.some((k) => k.startsWith("rl:t-b:"))).toBe(true);
  });

  it("rejects a request with no resolvable tenant — never defaults it", async () => {
    const { deps } = harness();
    const app = await boot({ ...deps, tenantMode: "multi", tenantId: "tenant-local" });
    const res = await get(app, { authorization: "Bearer good" });
    expect(res.statusCode).toBe(403);
  });

  it("prefers the verified claim over a forged header", async () => {
    const { deps, rateKeys } = harness("t-claim");
    const app = await boot({ ...deps, tenantMode: "multi" });
    const res = await get(app, { authorization: "Bearer good", "x-tenant-id": "t-forged" });
    expect(res.statusCode).toBe(200);
    expect(rateKeys.some((k) => k.startsWith("rl:t-claim:"))).toBe(true);
    expect(rateKeys.some((k) => k.startsWith("rl:t-forged:"))).toBe(false);
  });

  it("keeps tenancy routes pinned to the deployment tenant (ADR-0014 8f exemption)", async () => {
    // The caller's VERIFIED tenant is t-other, so tenant resolution succeeds and it is the pin
    // (not "no tenant resolved") that must refuse.
    const { deps } = harness("t-other");
    const app = await boot({
      ...deps,
      tenantMode: "multi",
      prisma: {} as unknown as Database,
      tenantId: "tenant-local",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants",
      headers: { authorization: "Bearer good" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(/platform-operator/);
  });
});

describe("createAdminHttpApi — single mode is unchanged", () => {
  it("still locks every request to the pinned tenant", async () => {
    const { deps } = harness();
    const app = await boot({ ...deps, tenantId: "tenant-local" });
    const other = await get(app, { authorization: "Bearer good", "x-tenant-id": "t-other" });
    expect(other.statusCode).toBe(403);
  });
});

describe("pinRoutesToTenant", () => {
  const route = defineRoute({
    method: "GET",
    path: "/probe",
    version: 1,
    permission: "tenancy:read",
    summary: "probe",
    schema: {},
    handle: async () => ({ status: 200, body: { ok: true } }),
  });
  const ctx = (tenantId: string) =>
    ({ context: { tenantId, principal: staff, requestId: "r", correlationId: "c" } }) as never;

  it("passes the pinned tenant through and rejects every other", async () => {
    const [pinned] = pinRoutesToTenant([route], "tenant-local");
    expect(await pinned?.handle(ctx("tenant-local"))).toEqual({ status: 200, body: { ok: true } });
    await expect(Promise.resolve().then(() => pinned?.handle(ctx("t-other")))).rejects.toThrow(
      /platform-operator/,
    );
  });
});
