import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AccessControl,
  Authenticator,
  AuthenticatedIdentity,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

/**
 * Plan 2B-1 — the staff API holds stock per variant: `GET /warehouses`, `variantId` on the stock
 * bodies and in the product's inventory rows, and the two inventory switches on the variant.
 * Drives the real HTTP stack (zod, permissions, presenter), like `product-details-routes.test.ts`.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-10-09T00:00:00.000Z") };
const authed = {
  authorization: "Bearer good",
  "x-tenant-id": "t-1",
  "content-type": "application/json",
};

function buildApp(accessControl?: AccessControl): Promise<FastifyInstance> {
  const claims = new Set<string>();
  const store = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
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
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    ...(accessControl === undefined ? {} : { accessControl }),
  });
}

interface VariantDetail {
  id: string;
  sku: string;
  tracksInventory: boolean;
  inventoryPolicy: string;
}
interface ProductDetail {
  variants: VariantDetail[];
}
interface StockRow {
  warehouseId: string;
  variantId: string | null;
  onHand: number;
  available: number;
}

describe("staff stock API — per variant (Plan 2B-1)", () => {
  let app: FastifyInstance;
  let counter = 0;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function post(url: string, payload?: Record<string, unknown>, headers = authed) {
    return app.inject({ method: "POST", url: `/api/v1${url}`, headers, payload });
  }
  async function get(url: string, headers = authed) {
    return app.inject({ method: "GET", url: `/api/v1${url}`, headers });
  }
  async function createProduct(variantCount = 1) {
    counter += 1;
    const res = await post("/products", {
      sku: `P-${counter}`,
      name: `Product ${counter}`,
      slug: `product-${counter}`,
      variants: Array.from({ length: variantCount }, (_, i) => ({
        sku: `P-${counter}-V${i + 1}`,
        priceAmountMinor: 1000,
        currency: "USD",
      })),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }
  async function detail(productId: string): Promise<ProductDetail> {
    const res = await get(`/products/${productId}`);
    expect(res.statusCode).toBe(200);
    return res.json() as ProductDetail;
  }

  it("lists the tenant's warehouses with id, code, name and status", async () => {
    const registered = await post("/warehouses", { code: "MAIN", name: "Main warehouse" });
    expect(registered.statusCode).toBe(201);
    const other = await post(
      "/warehouses",
      { code: "OTHER", name: "Other tenant's warehouse" },
      { ...authed, "x-tenant-id": "t-2" },
    );
    expect(other.statusCode).toBe(201);

    const res = await get("/warehouses?first=10");

    expect(res.statusCode).toBe(200);
    const page = res.json() as {
      items: { id: string; code: string; name: string; status: string }[];
      pageInfo: { hasNextPage: boolean };
    };
    const main = page.items.find((w) => w.code === "MAIN");
    expect(main).toMatchObject({ name: "Main warehouse", status: "active" });
    expect(typeof main?.id).toBe("string");
    expect(page.items.some((w) => w.code === "OTHER")).toBe(false);
  });

  it("holds stock per variant: two receipts make two rows, each naming its variant", async () => {
    const productId = await createProduct(2);
    const [m, l] = (await detail(productId)).variants;
    if (m === undefined || l === undefined) throw new Error("fixture failed");

    for (const [variantId, quantity] of [
      [m.id, 5],
      [l.id, 2],
    ] as const) {
      const res = await post("/inventory/receive", {
        productId,
        variantId,
        warehouseId: "wh-1",
        quantity,
      });
      expect(res.statusCode).toBe(200);
    }

    const res = await get(`/products/${productId}/inventory`);
    expect(res.statusCode).toBe(200);
    const rows = res.json() as StockRow[];
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.variantId === m.id)?.onHand).toBe(5);
    expect(rows.find((row) => row.variantId === l.id)?.onHand).toBe(2);
  });

  it("a receipt that names no variant still works for a one-variant product", async () => {
    const productId = await createProduct(1);
    const res = await post("/inventory/receive", { productId, warehouseId: "wh-1", quantity: 3 });
    expect(res.statusCode).toBe(200);
    const rows = (await get(`/products/${productId}/inventory`)).json() as StockRow[];
    expect(rows).toEqual([expect.objectContaining({ variantId: null, onHand: 3 })]);
  });

  it("stores the inventory switches on a variant, defaulting to tracked and deny", async () => {
    const productId = await createProduct(1);
    const variant = (await detail(productId)).variants[0];
    if (variant === undefined) throw new Error("fixture failed");
    expect(variant).toMatchObject({ tracksInventory: true, inventoryPolicy: "deny" });

    const res = await post(`/products/${productId}/variants/${variant.id}`, {
      sku: variant.sku,
      priceAmountMinor: 1000,
      currency: "USD",
      tracksInventory: false,
    });

    expect(res.statusCode).toBe(200);
    expect((await detail(productId)).variants[0]).toMatchObject({
      tracksInventory: false,
      inventoryPolicy: "deny",
    });
  });

  it("rejects an unknown inventory policy (422)", async () => {
    const productId = await createProduct(1);
    const variant = (await detail(productId)).variants[0];
    if (variant === undefined) throw new Error("fixture failed");

    const res = await post(`/products/${productId}/variants/${variant.id}`, {
      sku: variant.sku,
      priceAmountMinor: 1000,
      currency: "USD",
      inventoryPolicy: "sometimes",
    });

    expect(res.statusCode).toBe(422);
  });
});

describe("GET /warehouses — permission (Plan 2B-1)", () => {
  it("requires inventory:read (403 without it)", async () => {
    const app = await buildApp({
      authorize: async (_principal, permission) => permission !== "inventory:read",
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/warehouses",
        headers: authed,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
