import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedIdentity,
  Authenticator,
  Cache,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  IdGenerator,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

/**
 * Plan 3D, end to end over HTTP on the in-memory composition: orders are placed through the real
 * routes and `GET /analytics/sales` is read back. The clock stands at 2026-07-05 00:00 UTC, which is
 * 03:00 on July 5 in the default shop zone (Africa/Cairo), so "today" is 2026-07-05.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-07-05T00:00:00.000Z") };

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

const headersFor = (tenant: string) => ({
  authorization: "Bearer good",
  "x-tenant-id": tenant,
  "content-type": "application/json",
});

describe("GET /analytics/sales (end to end)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail: new InMemoryAuditTrail(),
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function place(
    tenant: string,
    currency: string,
    unitPriceAmountMinor: number,
    quantity: number,
  ) {
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: headersFor(tenant),
      payload: {
        customerRef: "customer-1",
        currency,
        items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor, quantity }],
        shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "EG" },
      },
    });
    expect(placed.statusCode).toBe(201);
  }

  async function sales(tenant: string, from: string, to: string) {
    return app.inject({
      method: "GET",
      url: `/api/v1/analytics/sales?from=${from}&to=${to}`,
      headers: headersFor(tenant),
    });
  }

  it("counts a shop's own orders in the shop's currency and never another shop's", async () => {
    await place("shop-a", "EGP", 1999, 2); // 3998
    await place("shop-a", "EGP", 500, 1); // 500
    await place("shop-a", "USD", 7777, 1); // another currency: counted aside, not summed
    await place("shop-b", "EGP", 99_999, 1); // somebody else's

    const a = await sales("shop-a", "2026-07-05", "2026-07-06");
    const b = await sales("shop-b", "2026-07-05", "2026-07-06");

    expect(a.statusCode).toBe(200);
    expect(a.json().current).toMatchObject({
      totalSalesMinor: 4498,
      ordersCount: 2,
      averageOrderValueMinor: 2249,
      ordersToFulfill: 3,
      otherCurrencyOrders: 1,
    });
    expect(a.json().currency).toBe("EGP");
    expect(a.json().timezone).toBe("Africa/Cairo");
    expect(a.json().current.daily).toEqual([{ date: "2026-07-05", salesMinor: 4498, orders: 2 }]);
    expect(a.json().previous).toMatchObject({ totalSalesMinor: 0, ordersCount: 0 });
    expect(JSON.stringify(a.json())).not.toContain("99999");

    expect(b.json().current).toMatchObject({
      totalSalesMinor: 99_999,
      ordersCount: 1,
      ordersToFulfill: 1,
      otherCurrencyOrders: 0,
    });
  });

  it("shows zeros, not an error, for a shop with no orders", async () => {
    const response = await sales("shop-empty", "2026-07-05", "2026-07-08");

    expect(response.statusCode).toBe(200);
    expect(response.json().current).toMatchObject({
      totalSalesMinor: 0,
      ordersCount: 0,
      averageOrderValueMinor: 0,
      ordersToFulfill: 0,
      topProducts: [],
    });
    expect(response.json().current.daily).toHaveLength(3);
  });

  it("answers 400 for a bad range", async () => {
    const response = await sales("shop-a", "2026-07-06", "2026-07-05");

    expect(response.statusCode).toBe(400);
  });

  it("refuses a caller who is not signed in", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/sales?from=2026-07-05&to=2026-07-06",
      headers: { "x-tenant-id": "shop-a" },
    });

    expect(response.statusCode).toBe(401);
  });
});
