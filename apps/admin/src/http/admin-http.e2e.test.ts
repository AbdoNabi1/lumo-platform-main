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
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

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

const authed = {
  authorization: "Bearer good",
  "x-tenant-id": "t-1",
  "content-type": "application/json",
};

describe("Admin HTTP API (end to end, in-process)", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
      // H-04 (audit): exposeDocs now defaults to false — this suite's own "publishes the OpenAPI
      // document" test below needs it explicitly on, same as a real local-dev composition root.
      exposeDocs: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("places and refunds an order through transport → facade → use case → domain", async () => {
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: authed,
      payload: {
        customerRef: "customer-1",
        currency: "USD",
        items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
        shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      },
    });
    expect(placed.statusCode).toBe(201);
    const orderId = placed.json().orderId as string;

    // Business-rule errors surface through the context's own presenter (409, unpaid refund).
    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${orderId}/refund`,
      headers: { authorization: authed.authorization, "x-tenant-id": authed["x-tenant-id"] },
    });
    expect(refused.statusCode).toBe(409);

    // Authorization decisions were audited (ADR-0009) for every action.
    expect(auditTrail.snapshot().map((e) => e.permission)).toEqual(
      expect.arrayContaining(["orders:place", "orders:refund"]),
    );
  });

  it("marks an order paid through the dedicated mark-paid route (Sprint A1)", async () => {
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: authed,
      payload: {
        customerRef: "customer-1",
        currency: "USD",
        items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
        shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      },
    });
    const orderId = placed.json().orderId as string;

    const paid = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${orderId}/mark-paid`,
      headers: authed,
      payload: { paymentRef: "payment-1" },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().status).toBe("paid");

    expect(auditTrail.snapshot().map((e) => e.permission)).toEqual(
      expect.arrayContaining(["orders:mark_paid"]),
    );
  });

  it("rejects asserting payment completion via the generic advance route (Sprint A1, 422)", async () => {
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: authed,
      payload: {
        customerRef: "customer-1",
        currency: "USD",
        items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
        shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      },
    });
    const orderId = placed.json().orderId as string;

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${orderId}/advance`,
      headers: authed,
      payload: { toStatus: "paid" },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("VALIDATION");
  });

  it("rejects invalid bodies at the boundary with 422 field issues (zod)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: authed,
      payload: { customerRef: "", currency: "US", items: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("requires authentication and a tenant", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/orders", payload: {} })).statusCode,
    ).toBe(401);
    const noTenant = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: "Bearer good" },
      payload: {},
    });
    expect(noTenant.statusCode).toBe(403);
  });

  it("publishes the OpenAPI document for the versioned admin surface", async () => {
    const spec = (await app.inject({ url: "/openapi.json" })).json();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/orders",
        "/api/v1/products",
        "/api/v1/orders/{orderId}/refund",
      ]),
    );
  });
});

describe("GET /orders (list)", () => {
  // A dedicated app + a monotonic id generator (unlike `fakes()`'s random-per-call ids above):
  // `PrismaOrderRepository.list`/`InMemoryOrderRepository.list` both sort on `id`, relying on real
  // ids being UUIDv7 (time-ordered) in production (D-022) — this generator reproduces that
  // ordering property deterministically so "most recent first" is actually verifiable here.
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    let n = 0;
    const idGenerator: IdGenerator = {
      generate: () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`,
    };
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function placeOrder(): Promise<string> {
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: authed,
      payload: {
        customerRef: "customer-1",
        currency: "USD",
        items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 1 }],
        shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      },
    });
    return placed.json().orderId as string;
  }

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/orders" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an out-of-range page size at the boundary (422, zod)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/orders?first=0", headers: authed });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("returns an empty page before any order has been placed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/orders", headers: authed });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
  });

  it("lists orders most-recently-placed first, cursor-paginated, as flat DTOs", async () => {
    const first = await placeOrder();
    const second = await placeOrder();
    const third = await placeOrder();

    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/orders?first=2",
      headers: authed,
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json() as {
      items: readonly { id: string }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
    expect(body1.items.map((o) => o.id)).toEqual([third, second]);
    expect(body1.pageInfo.hasNextPage).toBe(true);
    expect(body1.pageInfo.endCursor).not.toBeNull();

    // Every item is a flat, hand-typed DTO — no leaked Entity internals (props/_id/_domainEvents).
    for (const item of body1.items) {
      expect(item).toEqual({
        id: expect.any(String),
        orderNumber: expect.any(String),
        customerRef: "customer-1",
        status: "placed",
        currency: "USD",
        totalMinor: 1999,
        createdAt: expect.any(String),
      });
    }

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/orders?first=2&after=${body1.pageInfo.endCursor}`,
      headers: authed,
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json() as { items: readonly { id: string }[] };
    expect(body2.items.map((o) => o.id)).toEqual([first]);

    expect(auditTrail.snapshot().map((e) => e.permission)).toEqual(
      expect.arrayContaining(["orders:read"]),
    );
  });

  it("filters by status", async () => {
    const orderId = await placeOrder();
    await app.inject({
      method: "POST",
      url: `/api/v1/orders/${orderId}/mark-paid`,
      headers: authed,
      payload: { paymentRef: "pay-1" },
    });
    await placeOrder();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders?status=paid",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: readonly { id: string; status: string }[] };
    expect(body.items).toEqual([expect.objectContaining({ id: orderId, status: "paid" })]);
  });

  it("filters by search, matching order number or customer ref", async () => {
    const orderId = await placeOrder();
    await placeOrder();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders?search=customer-1",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: readonly { id: string }[] };
    expect(body.items.map((o) => o.id)).toEqual(expect.arrayContaining([orderId]));

    const noMatch = await app.inject({
      method: "GET",
      url: "/api/v1/orders?search=nonexistent-customer",
      headers: authed,
    });
    expect((noMatch.json() as { items: readonly unknown[] }).items).toEqual([]);
  });

  it("rejects an invalid status filter value at the boundary (422, zod)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders?status=not-a-real-status",
      headers: authed,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("GET /orders/:orderId (detail)", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 404 for an unknown order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders/00000000-0000-7000-8000-000000000000",
      headers: authed,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns a flat DTO with items/totals/addresses/history — no leaked Entity internals", async () => {
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: authed,
      payload: {
        customerRef: "customer-42",
        currency: "USD",
        items: [{ productId: "p-1", name: "Toy Wagon", unitPriceAmountMinor: 1999, quantity: 2 }],
        shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      },
    });
    const orderId = placed.json().orderId as string;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${orderId}`,
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // No `props`/`_id`/`_domainEvents` — the exact leak this DTO fixes.
    expect(body).not.toHaveProperty("props");
    expect(body).not.toHaveProperty("_id");
    expect(body).toMatchObject({
      id: orderId,
      customerRef: "customer-42",
      status: "placed",
      currency: "USD",
      totalMinor: 3998,
      shippingAddress: { line1: "1 Main St", city: "Town", postalCode: "12345", country: "US" },
      billingAddress: null,
      paymentRef: null,
      fulfillmentRef: null,
    });
    expect(body.items).toEqual([
      {
        id: expect.any(String),
        productId: "p-1",
        name: "Toy Wagon",
        unitPriceMinor: 1999,
        quantity: 2,
        lineTotalMinor: 3998,
      },
    ]);
    expect(body.history).toEqual([{ type: "placed", occurredAt: expect.any(String) }]);
  });
});

describe("GET /products (list) and /products/:productId (detail)", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication on both routes", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/products" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/products/some-id" })).statusCode).toBe(
      401,
    );
  });

  it("returns 404 for an unknown product", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products/00000000-0000-7000-8000-000000000000",
      headers: authed,
    });
    expect(res.statusCode).toBe(404);
  });

  it("lists and gets a created product as a flat DTO — no leaked Entity internals", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: authed,
      payload: {
        sku: "P-DTO-1",
        name: "Toy Wagon",
        slug: "toy-wagon-dto",
        variants: [{ sku: "P-DTO-1-RED", priceAmountMinor: 1999, currency: "USD" }],
      },
    });
    expect(create.statusCode).toBe(201);
    const productId = (create.json() as { id: string }).id;

    const listRes = await app.inject({ method: "GET", url: "/api/v1/products", headers: authed });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json() as { items: unknown[] };
    expect(listBody.items).toContainEqual({
      id: productId,
      sku: "P-DTO-1",
      name: "Toy Wagon",
      slug: "toy-wagon-dto",
      status: "draft",
      variantCount: 1,
      priceAmountMinor: 1999,
      currency: "USD",
    });

    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/products/${productId}`,
      headers: authed,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body).toEqual({
      id: productId,
      sku: "P-DTO-1",
      name: "Toy Wagon",
      slug: "toy-wagon-dto",
      status: "draft",
      scheduledAt: null,
      brandId: null,
      categoryIds: [],
      options: [],
      seoTitle: null,
      seoDescription: null,
      variants: [
        {
          id: expect.any(String),
          sku: "P-DTO-1-RED",
          priceAmountMinor: 1999,
          currency: "USD",
          selection: null,
        },
      ],
      mediaAssetIds: [],
    });
  });
});

describe("GET /categories (list) and GET /brands (list)", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication on both routes", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/categories" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/brands" })).statusCode).toBe(401);
  });

  it("lists a created category as a flat DTO — no leaked Entity internals", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/categories",
      headers: authed,
      payload: { name: "Outdoor Toys", slug: "outdoor-toys-dto" },
    });
    expect(create.statusCode).toBe(201);
    const categoryId = (create.json() as { id: string }).id;

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/categories",
      headers: authed,
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as { items: unknown[] };
    expect(body.items).toContainEqual({
      id: categoryId,
      name: "Outdoor Toys",
      slug: "outdoor-toys-dto",
      parentId: null,
    });
  });

  it("lists a created brand as a flat DTO — no leaked Entity internals", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/brands",
      headers: authed,
      payload: { name: "Acme", slug: "acme-dto" },
    });
    expect(create.statusCode).toBe(201);
    const brandId = (create.json() as { id: string }).id;

    const listRes = await app.inject({ method: "GET", url: "/api/v1/brands", headers: authed });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json() as { items: unknown[] };
    expect(body.items).toContainEqual({ id: brandId, name: "Acme", slug: "acme-dto" });
  });
});

describe("GET /products/:productId/inventory", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/products/some-id/inventory" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty array for a product with no stock rows", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products/no-such-product/inventory",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns stock rows received for the product", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: authed,
      payload: {
        sku: "P-INV-1",
        name: "Toy Drum",
        slug: "toy-drum",
        variants: [{ sku: "P-INV-1-A", priceAmountMinor: 999, currency: "USD" }],
      },
    });
    const productId = (create.json() as { id: string }).id;

    const receive = await app.inject({
      method: "POST",
      url: "/api/v1/inventory/receive",
      headers: authed,
      payload: { productId, warehouseId: "wh-1", quantity: 10 },
    });
    expect(receive.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/products/${productId}/inventory`,
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ warehouseId: "wh-1", onHand: 10, reserved: 0, available: 10 }]);
  });
});

describe("GET /orders/:orderId/fulfillment", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/orders/some-order/fulfillment" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 when no fulfillment order has been opened for the order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders/no-such-order/fulfillment",
      headers: authed,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns a flat DTO for the fulfillment order opened against the order", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/fulfillments",
      headers: authed,
      payload: { orderRef: "order-with-fulfillment", items: [{ productRef: "p-1", quantity: 2 }] },
    });
    expect(create.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders/order-with-fulfillment/fulfillment",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      orderRef: "order-with-fulfillment",
      status: "created",
      items: [{ productRef: "p-1", quantity: 2 }],
      carrier: null,
      carrierShipmentId: null,
      trackingNumber: null,
      deliveredAt: null,
      packages: [],
    });
  });
});

describe("GET /fulfillments/:fulfillmentOrderId/shipment", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/fulfillments/some-id/shipment" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 when no shipment has been opened for the fulfillment order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/fulfillments/no-such-fulfillment/shipment",
      headers: authed,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns a flat DTO for the shipment opened against the fulfillment order", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/shipments",
      headers: authed,
      payload: {
        fulfillmentRef: "fulfillment-with-shipment",
        packages: [{ reference: "pkg-1", itemRefs: ["item-1"], weightGrams: 500 }],
      },
    });
    expect(create.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/fulfillments/fulfillment-with-shipment/shipment",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      fulfillmentRef: "fulfillment-with-shipment",
      status: "created",
      carrier: null,
      carrierService: null,
      trackingNumber: null,
      shippedAt: null,
      deliveredAt: null,
    });
  });
});

describe("GET /orders/:orderId/return", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/orders/some-order/return" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 when no return request has been opened for the order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders/no-such-order/return",
      headers: authed,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns a flat DTO for the return request opened against the order", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: authed,
      payload: {
        orderRef: "order-with-return",
        items: [
          {
            orderItemRef: "order-item-1",
            productRef: "p-1",
            quantity: 1,
            reasonCode: "defective",
          },
        ],
      },
    });
    expect(create.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders/order-with-return/return",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      orderRef: "order-with-return",
      status: "requested",
      items: [
        {
          orderItemRef: "order-item-1",
          productRef: "p-1",
          quantity: 1,
          reasonCode: "defective",
          reasonNote: null,
          disposition: null,
        },
      ],
      rmaNumber: null,
      approved: null,
      approvalNote: null,
      refundOutcome: null,
      refundAmountMinor: null,
      refundCurrency: null,
    });
  });
});

describe("GET /coupons", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/coupons" });
    expect(res.statusCode).toBe(401);
  });

  it("lists a created coupon as a flat DTO", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/coupons",
      headers: authed,
      payload: { code: "SAVE10", promotionRef: "promo-1", multiUse: true, usageLimit: 100 },
    });
    expect(create.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/api/v1/coupons", headers: authed });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items).toContainEqual({
      id: expect.any(String),
      code: "SAVE10",
      promotionRef: "promo-1",
      status: "active",
      usageLimit: 100,
      usageCount: 0,
      expiresAt: null,
    });
  });
});

describe("GET /content-blocks", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/content-blocks" });
    expect(res.statusCode).toBe(401);
  });

  it("lists a created content block as a flat DTO", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/content-blocks",
      headers: authed,
      payload: {
        name: "homepage-hero",
        blockType: "hero",
        format: "html",
        content: "<h1>Hello</h1>",
      },
    });
    expect(create.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/api/v1/content-blocks", headers: authed });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items).toContainEqual({
      id: expect.any(String),
      name: "homepage-hero",
      blockType: "hero",
      status: "draft",
      locale: null,
    });
  });
});

describe("GET /automation/workflows", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/automation/workflows" });
    expect(res.statusCode).toBe(401);
  });

  it("lists a created workflow as a flat DTO, with no execution history yet", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/automation/workflows",
      headers: authed,
      payload: {
        name: "abandoned-cart-email",
        triggerType: "event",
        eventType: "cart.abandoned",
        actions: [{ actionType: "send_email" }],
      },
    });
    expect(create.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/automation/workflows",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items).toContainEqual({
      id: expect.any(String),
      name: "abandoned-cart-email",
      status: "draft",
      triggerType: "event",
      eventType: "cart.abandoned",
      cronExpression: null,
      lastExecution: null,
    });
  });
});

describe("GET /customers", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/customers" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty cursor page for a fresh tenant", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/customers", headers: authed });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; pageInfo: { hasNextPage: boolean } };
    expect(body.items).toEqual([]);
    expect(body.pageInfo.hasNextPage).toBe(false);
  });
});

describe("GET /customers/:customerId", () => {
  let app: FastifyInstance;
  const auditTrail = new InMemoryAuditTrail();

  beforeAll(async () => {
    const f = fakes();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: f.idGenerator,
      clock,
      auditTrail,
      authenticator: f.authenticator,
      rateLimiter: f.rateLimiter,
      idempotencyKeys: f.idempotencyKeys,
      responseCache: f.cache,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/customers/some-id" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an unknown customer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/customers/00000000-0000-7000-8000-000000000000",
      headers: authed,
    });
    expect(res.statusCode).toBe(404);
  });
});
