import { beforeEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireIdentity, type WiredIdentity } from "@platform/identity";
import { wireLoyalty, type WiredLoyalty } from "@platform/loyalty";
import { wireSecurity, type WiredSecurity } from "@platform/security";
import type { WiredAdmin } from "../composition";
import { CustomerAuthAdminController } from "../interfaces/customer-auth.admin-controller";
import type { CustomerCredentialsPort } from "../interfaces/customer-credentials.port";
import { CustomerGuard } from "../interfaces/customer-guard";
import { publicAuthRoutes } from "./public-auth-routes";
import { publicLoyaltyRoutes, type PublicLoyaltyAccountDto } from "./public-loyalty-routes";

/**
 * The customer loyalty-balance surface (T5.19) over REAL compositions, reached through real
 * customer sessions established by `public-auth-routes.ts` — no stubbed guard, no fabricated
 * session. Same discipline as `public-wishlist-routes.test.ts`: most of what follows tries to reach
 * another customer's account or an account that doesn't exist, and asserts it fails honestly.
 */

const clock: Clock = { now: () => new Date("2026-08-31T00:00:00.000Z") };

function sequentialIds(prefix: string): IdGenerator {
  let counter = 0;
  return { generate: () => `${prefix}-${(counter += 1)}` };
}

interface Harness {
  readonly admin: WiredAdmin;
  readonly loyalty: WiredLoyalty;
}

function harness(): Harness {
  const deps = {
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds("id"),
    clock,
  };
  const security: WiredSecurity = wireSecurity(deps);
  const identity: WiredIdentity = wireIdentity(deps);
  const loyalty = wireLoyalty(deps);

  const credentials: CustomerCredentialsPort = {
    registerSubject: async (subjectRef) => {
      security.identityDirectory.register(subjectRef);
    },
    setPassword: async (identifier, password, principalExternalId) => {
      security.passwordProvider.register(identifier, password, principalExternalId);
    },
  };
  const customerAuth = new CustomerAuthAdminController({
    security: security.security,
    customers: identity.customers,
    credentials,
    guard: new CustomerGuard({ security: security.security, customers: identity.customers }),
    idGenerator: sequentialIds("refresh"),
    sessionTtlSeconds: 3600,
  });

  const admin = {
    customerAuth,
    publicReads: {
      security: security.security,
      customers: identity.customers,
      loyalty: loyalty.loyalty,
    },
  } as unknown as WiredAdmin;

  return { admin, loyalty };
}

interface Response {
  readonly status: number;
  readonly body: unknown;
}

function callRoute(
  routes: readonly { method: string; path: string; handle: (i: unknown) => unknown }[],
  method: string,
  path: string,
  options: { body?: unknown; sessionId?: string } = {},
): Promise<Response> {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  return route.handle({
    body: options.body ?? {},
    params: {},
    query: {},
    context: {
      tenantId: "tenant-local",
      requestId: "req-1",
      headers: options.sessionId !== undefined ? { "x-customer-session": options.sessionId } : {},
    },
  }) as Promise<Response>;
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

function loyaltyMe(options: { sessionId?: string } = {}) {
  return callRoute(publicLoyaltyRoutes(h.admin) as never, "GET", "/public/loyalty/accounts/me", options);
}

/** Registers + signs in a customer through the real auth routes, returning a real session id. */
async function signIn(email: string): Promise<{ sessionId: string; customerRef: string }> {
  const auth = publicAuthRoutes(h.admin) as never;
  const registered = await callRoute(auth, "POST", "/public/auth/register", {
    body: { email, name: "Shopper", password: "correct-horse" },
  });
  expect(registered.status).toBe(201);
  const loggedIn = await callRoute(auth, "POST", "/public/auth/login", {
    body: { email, password: "correct-horse" },
  });
  expect(loggedIn.status).toBe(200);
  return loggedIn.body as { sessionId: string; customerRef: string };
}

describe("GET /public/loyalty/accounts/me", () => {
  it("401s without a session — never a 404 or a balance for an anonymous caller", async () => {
    const response = await loyaltyMe();

    expect(response.status).toBe(401);
  });

  it("404s for a signed-in customer who has no loyalty account yet — never a fabricated zero balance", async () => {
    const { sessionId } = await signIn("a@example.com");

    const response = await loyaltyMe({ sessionId });

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('"balance"');
  });

  it("returns the caller's own balance, tier, and transactions once an account exists", async () => {
    const { sessionId, customerRef } = await signIn("a@example.com");
    const opened = (await h.loyalty.loyalty.open({ customerRef })).body as { accountId: string };
    await h.loyalty.loyalty.earn({
      accountId: opened.accountId,
      idempotencyKey: "earn-1",
      points: 150,
      ref: "order-1",
    });

    const response = await loyaltyMe({ sessionId });

    expect(response.status).toBe(200);
    const dto = response.body as PublicLoyaltyAccountDto;
    expect(dto.balance).toBe(150);
    expect(dto.status).toBe("active");
    expect(dto.tierName).toBeTruthy();
    expect(dto.transactions).toHaveLength(1);
    expect(dto.transactions[0]?.pointsDelta).toBe(150);
    expect(dto.transactions[0]?.ref).toBe("order-1");
  });

  it("never puts the customerRef on the wire", async () => {
    const { sessionId, customerRef } = await signIn("a@example.com");
    await h.loyalty.loyalty.open({ customerRef });

    const response = await loyaltyMe({ sessionId });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(customerRef);
    expect(Object.keys(response.body as object).sort()).toEqual([
      "balance",
      "id",
      "status",
      "tierName",
      "transactions",
    ]);
  });

  it("returns a flat DTO — no LoyaltyAccount aggregate internals reach the wire", async () => {
    const { sessionId, customerRef } = await signIn("a@example.com");
    await h.loyalty.loyalty.open({ customerRef });

    const serialized = JSON.stringify((await loyaltyMe({ sessionId })).body);
    for (const leak of ["props", "_id", "_domainEvents", "_version"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("keeps two customers' balances completely separate", async () => {
    const a = await signIn("a@example.com");
    const b = await signIn("b@example.com");
    const openedA = (await h.loyalty.loyalty.open({ customerRef: a.customerRef })).body as {
      accountId: string;
    };
    await h.loyalty.loyalty.earn({
      accountId: openedA.accountId,
      idempotencyKey: "earn-a",
      points: 300,
      ref: "order-a",
    });
    // B never opens an account at all.

    const aResponse = await loyaltyMe({ sessionId: a.sessionId });
    const bResponse = await loyaltyMe({ sessionId: b.sessionId });

    expect(aResponse.status).toBe(200);
    expect((aResponse.body as PublicLoyaltyAccountDto).balance).toBe(300);
    expect(bResponse.status).toBe(404);
  });

  it("stops reaching the balance the moment the session is revoked", async () => {
    const { sessionId, customerRef } = await signIn("a@example.com");
    await h.loyalty.loyalty.open({ customerRef });
    await callRoute(publicAuthRoutes(h.admin) as never, "POST", "/public/auth/logout", { sessionId });

    expect((await loyaltyMe({ sessionId })).status).toBe(401);
  });
});

describe("route declarations", () => {
  it("declares the route public and scoped to /me — no accountId or customerRef in the path", () => {
    for (const route of publicLoyaltyRoutes(h.admin)) {
      expect(route.public).toBe(true);
      expect(route.path.startsWith("/public/loyalty/accounts/me")).toBe(true);
      expect(route.path).not.toContain(":accountId");
      expect(route.path).not.toContain(":customerRef");
    }
  });
});
