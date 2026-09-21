import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedContext,
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { createAdminHttpApi } from "./server";

/**
 * WP-1 (G-52), the transport half. `public-checkout-routes.test.ts` drives the guest flow through
 * `RouteDefinition.handle()`; this suite drives it through the REAL admin pipeline
 * (`createAdminHttpApi`, `tenantMode: "multi"`, real tenant resolvers, real error mapping) with only
 * the infrastructure ports doubled — same technique as `tenant-isolation.e2e.test.ts`.
 *
 * What only the pipeline can show:
 *  - the same guest email in two tenants really is two customers, when the tenant is resolved by
 *    the transport from the request (not handed in by the test);
 *  - a guest checkout with no contact email answers 422, not 500, over the wire;
 *  - after a guest checkout with a REGISTERED customer's email, the anonymous public principal
 *    (ADR-0015: bound to the request's tenant, id `public`, no roles) is unchanged — observed as
 *    `GET /public/auth/me` and the other customer-scoped routes still answering 401.
 */

const clock: Clock = { now: () => new Date("2026-09-21T00:00:00.000Z") };
const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: staff, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: staff, claims: { tenant_id: "tenant-b" } },
};

function infra() {
  const kv = new Map<string, unknown>();
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
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 999, retryAfterMs: 0 }),
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => sessions[token]?.principal ?? null,
    verifyWithClaims: async (token) => sessions[token] ?? null,
  };
  return { cache, idempotencyKeys, rateLimiter, authenticator };
}

let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

describe("guest checkout through the real HTTP pipeline (WP-1, G-52)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const fx = infra();
    app = await createAdminHttpApi({
      tenantMode: "multi",
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

  const admin = (token: string) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
  const storefront = (tenant: string, extra: Record<string, string> = {}) => ({
    "x-tenant-id": tenant,
    "content-type": "application/json",
    ...extra,
  });

  async function post(url: string, headers: Record<string, string>, payload: unknown) {
    return app.inject({
      method: "POST",
      url: `/api/v1${url}`,
      headers,
      payload: payload as object,
    });
  }
  async function get(url: string, headers: Record<string, string>) {
    return app.inject({ method: "GET", url: `/api/v1${url}`, headers });
  }
  function ok<T>(res: { statusCode: number; body: string; json: () => unknown }, what: string): T {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${what} failed (${res.statusCode}): ${res.body}`);
    }
    return res.json() as T;
  }

  /** A published price for `product-1` in one tenant, made by that tenant's staff. */
  async function seedPrice(token: string): Promise<void> {
    const created = ok<{ id: string }>(
      await post("/prices", admin(token), {
        priceListId: "price-list-1",
        productId: "product-1",
        amountMinor: 1999,
        currency: "USD",
      }),
      "create price",
    );
    ok(await post(`/prices/${created.id}/publish`, admin(token), {}), "publish price");
  }

  const address = { line1: "1 Main St", city: "Springfield", postalCode: "00000", country: "US" };

  /** cart → checkout → everything up to (not including) complete, all as the anonymous storefront. */
  async function readyCheckout(tenant: string, sessionRef: string, email?: string) {
    const h = storefront(tenant);
    const cart = ok<{ id: string }>(
      await post("/public/carts", h, { sessionRef, currency: "USD" }),
      "create cart",
    );
    ok(
      await post(`/public/carts/${cart.id}/items`, h, {
        sessionRef,
        productId: "product-1",
        quantity: 1,
      }),
      "add item",
    );
    const started = ok<{ id: string }>(
      await post("/public/checkouts", h, { sessionRef, cartRef: cart.id, currency: "USD" }),
      "start checkout",
    );
    const base = `/public/checkouts/${started.id}`;
    ok(await post(`${base}/items`, h, { sessionRef, cartId: cart.id }), "load items");
    ok(await post(`${base}/billing-address`, h, { sessionRef, ...address }), "billing");
    ok(await post(`${base}/shipping-address`, h, { sessionRef, ...address }), "shipping");
    ok(
      await post(`${base}/shipping-selection`, h, { sessionRef, method: "standard" }),
      "shipping method",
    );
    ok(
      await post(`${base}/payment-selection`, h, {
        sessionRef,
        paymentMethodRef: "pm_1",
        provider: "stripe",
      }),
      "payment",
    );
    if (email !== undefined) ok(await post(`${base}/contact`, h, { sessionRef, email }), "contact");
    ok(await post(`${base}/recalculate`, h, { sessionRef }), "recalculate");
    return {
      checkoutId: started.id,
      complete: () =>
        post(`${base}/complete`, h, { sessionRef, idempotencyKey: `idem-${sessionRef}` }),
    };
  }

  /** The customer an order was placed against, read back by that tenant's own staff. */
  async function orderCustomerRef(token: string, orderId: string): Promise<string> {
    const order = ok<Record<string, unknown>>(
      await get(`/orders/${orderId}`, admin(token)),
      "get order",
    );
    const ref = order["customerRef"];
    if (typeof ref !== "string") {
      throw new Error(`order has no customerRef: ${JSON.stringify(order)}`);
    }
    return ref;
  }

  it("a guest completes cart → checkout → complete over HTTP and an order exists afterwards", async () => {
    await seedPrice("tok-a");
    const checkout = await readyCheckout("tenant-a", "sess-1", "guest@example.com");

    const done = await checkout.complete();

    expect(done.statusCode).toBe(200);
    const body = done.json() as { status: string; orderRef: string | null; contactEmail: string };
    expect(body.status).toBe("completed");
    expect(body.orderRef).not.toBeNull();
    expect(body.contactEmail).toBe("guest@example.com");
    // The order is real: tenant A's staff can read it, attached to a customer.
    expect((await orderCustomerRef("tok-a", body.orderRef as string)).length).toBeGreaterThan(0);
  });

  it("completing without a contact email is a 422 over the wire, not a 500, and creates no order", async () => {
    await seedPrice("tok-a");
    const checkout = await readyCheckout("tenant-a", "sess-2");

    const done = await checkout.complete();

    expect(done.statusCode).toBe(422);
    expect((done.json() as { code: string }).code).toBe("VALIDATION");
    const after = ok<{ status: string; orderRef: string | null }>(
      await get(
        `/public/checkouts/${checkout.checkoutId}`,
        storefront("tenant-a", { "x-cart-session": "sess-2" }),
      ),
      "get checkout",
    );
    expect(after.status).toBe("started");
    expect(after.orderRef).toBeNull();
  });

  it("the same guest email in tenant A and tenant B resolves to two different customers", async () => {
    await seedPrice("tok-a");
    await seedPrice("tok-b");
    const inA = await (await readyCheckout("tenant-a", "sess-a", "shared@example.com")).complete();
    const inB = await (await readyCheckout("tenant-b", "sess-b", "shared@example.com")).complete();
    const orderA = (inA.json() as { orderRef: string }).orderRef;
    const orderB = (inB.json() as { orderRef: string }).orderRef;

    const customerA = await orderCustomerRef("tok-a", orderA);
    const customerB = await orderCustomerRef("tok-b", orderB);

    expect(customerA).not.toBe(customerB);
    // Neither tenant's staff can see the other tenant's customer.
    expect((await get(`/customers/${customerA}`, admin("tok-b"))).statusCode).toBe(404);
    expect((await get(`/customers/${customerB}`, admin("tok-a"))).statusCode).toBe(404);
    // And within a tenant a returning guest is the same customer.
    const again = await (
      await readyCheckout("tenant-a", "sess-a2", "shared@example.com")
    ).complete();
    expect(await orderCustomerRef("tok-a", (again.json() as { orderRef: string }).orderRef)).toBe(
      customerA,
    );
  });

  it("T1.8: a guest checking out with a REGISTERED customer's email attaches the order but gains no identity — the public principal is unchanged", async () => {
    await seedPrice("tok-a");
    const h = storefront("tenant-a");
    ok(
      await post("/public/auth/register", h, {
        email: "victim@example.com",
        name: "Vera Victim",
        password: "correct-horse",
      }),
      "register victim",
    );
    const victimId = ok<{ items: { id: string; email: string }[] }>(
      await get("/customers?search=victim%40example.com", admin("tok-a")),
      "find victim",
    ).items[0]?.id;
    expect(victimId).toBeDefined();

    const checkout = await readyCheckout("tenant-a", "sess-attacker", "victim@example.com");
    const done = await checkout.complete();
    expect(done.statusCode).toBe(200);
    const wire = done.body;

    // The order is attached to the existing customer...
    expect(await orderCustomerRef("tok-a", (done.json() as { orderRef: string }).orderRef)).toBe(
      victimId,
    );
    // ...but the wire shape carries neither the victim's id nor their name...
    expect(wire).not.toContain(victimId as string);
    expect(wire).not.toContain("Vera Victim");
    // ...and the guest is still anonymous: every customer-scoped route refuses, whether the
    // request presents nothing, the guest's own session, or ids/emails it could have learned.
    const identities: Record<string, string>[] = [
      {},
      { "x-cart-session": "sess-attacker" },
      { "x-customer-session": "sess-attacker" },
      { "x-customer-session": checkout.checkoutId },
      { "x-customer-session": victimId as string },
      { "x-customer-session": "victim@example.com" },
    ];
    for (const extra of identities) {
      for (const path of [
        "/public/auth/me",
        "/public/loyalty/accounts/me",
        "/public/wishlists/me",
      ]) {
        const res = await get(path, storefront("tenant-a", extra));
        expect(res.statusCode, `${path} with ${JSON.stringify(extra)}`).toBe(401);
      }
    }
  });
});
