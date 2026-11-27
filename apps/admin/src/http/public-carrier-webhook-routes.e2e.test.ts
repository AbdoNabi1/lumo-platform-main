import type {
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createAdminHttpApi, type AdminHttpDeps } from "./server";
import { UNAUTHORIZED_BODY } from "./public-carrier-webhook-routes";

/**
 * Review Focus 3 at the transport: the REAL endpoint, under TENANT_MODE=multi. Harness copied from
 * `tenant-lifecycle.e2e.test.ts`; the unknown-tenant body mirrors `packages/http/src/tenant-gate.test.ts`.
 */
beforeEach(() => {
  expect.hasAssertions();
});

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
  const operator = await app.inject({
    method: "POST",
    url: "/api/v1/tenants",
    headers: { authorization: "Bearer op", "idempotency-key": crypto.randomUUID() },
    payload: { slug: "acme", name: "acme", isolationTier: "pooled" },
  });
  const tenantId = (operator.json() as { id: string }).id;
  const webhook = (headers: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: "/api/v1/public/shipping/webhook/bosta",
      headers: { "content-type": "application/json", ...headers },
      payload: JSON.stringify({ trackingNumber: 48089608, state: 24, type: "SEND" }),
    });
  return { webhook, tenantId };
}

describe("public carrier webhook over HTTP (multi mode)", () => {
  it("a known tenant with a wrong secret is the 401 UNAUTHORIZED_BODY", async () => {
    const { webhook, tenantId } = await boot();
    const res = await webhook({ "x-tenant-id": tenantId, authorization: "wrong" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it("an unknown x-tenant-id is 403 TENANT_UNKNOWN", async () => {
    const { webhook } = await boot();
    const res = await webhook({ "x-tenant-id": "ghost", authorization: "s" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("TENANT_UNKNOWN");
  });

  it("no x-tenant-id is 403", async () => {
    const { webhook } = await boot();
    const res = await webhook({ authorization: "s" });
    expect(res.statusCode).toBe(403);
  });
});
