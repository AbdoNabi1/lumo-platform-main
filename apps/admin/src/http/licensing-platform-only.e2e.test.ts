import type {
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  IdGenerator,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createAdminHttpApi, type AdminHttpDeps } from "./server";

/**
 * WP-14 (T14.2, Trap 2): `licensing:plan:manage` (and its siblings) live on the MERCHANT's operator
 * surface. No seeded role holds them today, so a merchant could not price their own bill — but the
 * moment collection is real that is one permission grant away. This asserts the refusal at the
 * boundary: a merchant tenant that HOLDS the permission (the default `AllowAllAccessControl` here
 * models exactly that grant) is still refused, because the tenant — not the permission — is what
 * decides who may price a plan.
 */
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock = { now: () => new Date("2026-10-01T00:00:00.000Z") };
const PLATFORM = "platform-tenant";

function harness(claimTenant: string): AdminHttpDeps {
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
    verify: async (token) => (token === "good" ? staff : null),
    verifyWithClaims: async (token) =>
      token === "good" ? { principal: staff, claims: { tenant_id: claimTenant } } : null,
  };
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
  return {
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    tenantMode: "multi",
    tenantGate: { availability: async () => "active" as const }, // fixture tenants have no Tenant row (T10.6)
    tenantId: PLATFORM,
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot(claimTenant: string) {
  const app = await createAdminHttpApi(harness(claimTenant));
  apps.push(app);
  return app;
}

let idempotency = 0;
const post = (app: FastifyInstance, url: string, payload: unknown) =>
  app.inject({
    method: "POST",
    url: `/api/v1${url}`,
    headers: {
      authorization: "Bearer good",
      "content-type": "application/json",
      "idempotency-key": `k-${(idempotency += 1)}`,
    },
    payload: payload as object,
  });

const newPlan = { key: "self-priced", name: "Mine", tier: "custom" };

describe("licensing writes are platform-only under TENANT_MODE=multi", () => {
  it("refuses a merchant tenant that holds the permission from creating a plan", async () => {
    const app = await boot("t-merchant");
    const res = await post(app, "/plans", newPlan);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(/platform-owned/);
  });

  it("refuses a merchant tenant from creating a subscription, an invoice or a credit for itself", async () => {
    const app = await boot("t-merchant");
    const attempts = await Promise.all([
      post(app, "/subscriptions", { tenantRef: "t-merchant", planVersionRef: "p-v1" }),
      post(app, "/invoices", {
        tenantRef: "t-merchant",
        subscriptionRef: "s-1",
        currency: "EGP",
        lineItems: [{ description: "free", amountMinor: 1 }],
      }),
      post(app, "/credits", { tenantRef: "t-merchant", amount: 1000, reason: "self grant" }),
      post(app, "/subscriptions/s-1/renew", {}),
    ]);
    for (const res of attempts) expect(res.statusCode).toBe(403);
  });

  it("lets the platform-operator tenant create a plan", async () => {
    const app = await boot(PLATFORM);
    const res = await post(app, "/plans", newPlan);
    expect(res.statusCode).toBe(201);
  });

  it("fails closed when multi mode has no deployment tenant to name as the platform", async () => {
    const deps = { ...harness("t-merchant"), tenantId: undefined };
    const app = await createAdminHttpApi(deps);
    apps.push(app);
    const res = await post(app, "/plans", newPlan);
    expect(res.statusCode).toBe(403);
  });
});
