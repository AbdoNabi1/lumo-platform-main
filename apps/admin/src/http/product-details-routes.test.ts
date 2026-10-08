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
 * Plan 2C-1 — the staff API accepts Shopify's product and variant fields, returns them in the
 * detail DTO (cost included: this is the staff DTO), keeps the legacy admin-web bodies working
 * unchanged, and exposes the unlist route. Drives the real HTTP stack (zod, permissions, presenter).
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-10-08T00:00:00.000Z") };
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
  priceAmountMinor: number;
  currency: string;
  selection: Record<string, string> | null;
  compareAtAmountMinor: number | null;
  costAmountMinor: number | null;
  barcode: string | null;
  weightGrams: number | null;
  requiresShipping: boolean;
  taxable: boolean;
}
interface ProductDetail {
  id: string;
  status: string;
  description: string | null;
  productType: string | null;
  tags: string[];
  variants: VariantDetail[];
}

describe("staff product API — Shopify product data (Plan 2C-1)", () => {
  let app: FastifyInstance;
  let skuCounter = 0;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function post(url: string, payload?: Record<string, unknown>) {
    return app.inject({ method: "POST", url: `/api/v1${url}`, headers: authed, payload });
  }
  async function detail(productId: string): Promise<ProductDetail> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/products/${productId}`,
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as ProductDetail;
  }
  async function createProduct(extra: Record<string, unknown> = {}, variantExtra = {}) {
    skuCounter += 1;
    const res = await post("/products", {
      sku: `P-${skuCounter}`,
      name: `Product ${skuCounter}`,
      slug: `product-${skuCounter}`,
      variants: [
        {
          sku: `P-${skuCounter}-V1`,
          priceAmountMinor: 1000,
          currency: "USD",
          ...variantExtra,
        },
      ],
      ...extra,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  it("creates a product with details and variant attributes, and returns them all", async () => {
    const id = await createProduct(
      {
        description: "Soft cotton.\nMachine wash.",
        productType: "Shirts",
        tags: ["Summer", "sale"],
      },
      {
        compareAtAmountMinor: 1500,
        costAmountMinor: 400,
        barcode: "6221234567890",
        weightGrams: 250,
        requiresShipping: false,
        taxable: false,
      },
    );
    const product = await detail(id);
    expect(product.description).toBe("Soft cotton.\nMachine wash.");
    expect(product.productType).toBe("Shirts");
    expect(product.tags).toEqual(["Summer", "sale"]);
    expect(product.variants[0]).toMatchObject({
      compareAtAmountMinor: 1500,
      costAmountMinor: 400,
      barcode: "6221234567890",
      weightGrams: 250,
      requiresShipping: false,
      taxable: false,
    });
  });

  it("an update with only name/slug keeps the description; description: null clears it", async () => {
    const id = await createProduct({ description: "Keep me", tags: ["a"] });
    const renamed = await post(`/products/${id}`, { name: "Renamed", slug: "renamed-1" });
    expect(renamed.statusCode).toBe(200);
    let product = await detail(id);
    expect(product.description).toBe("Keep me");
    expect(product.tags).toEqual(["a"]);

    const cleared = await post(`/products/${id}`, {
      name: "Renamed",
      slug: "renamed-1",
      description: null,
    });
    expect(cleared.statusCode).toBe(200);
    product = await detail(id);
    expect(product.description).toBeNull();
    expect(product.tags).toEqual(["a"]);
  });

  it("the exact admin-web variant body keeps the attributes; selection works on a published product", async () => {
    const id = await createProduct({}, { compareAtAmountMinor: 1500, weightGrams: 100 });
    const variant = (await detail(id)).variants[0];
    if (variant === undefined) throw new Error("fixture failed");

    // admin-web sends exactly { sku, priceAmountMinor, currency }.
    const legacy = await post(`/products/${id}/variants/${variant.id}`, {
      sku: variant.sku,
      priceAmountMinor: 1100,
      currency: "USD",
    });
    expect(legacy.statusCode).toBe(200);
    let current = (await detail(id)).variants[0];
    expect(current?.priceAmountMinor).toBe(1100);
    expect(current?.compareAtAmountMinor).toBe(1500);
    expect(current?.weightGrams).toBe(100);

    // Publish, then add a size option and place the variant on it: options are open after publishing.
    expect((await post(`/products/${id}/publish`)).statusCode).toBe(200);
    const options = await post(`/products/${id}/options`, {
      options: [{ name: "Size", values: ["S", "L"] }],
    });
    expect(options.statusCode).toBe(200);
    const selected = await post(`/products/${id}/variants/${variant.id}`, {
      sku: variant.sku,
      priceAmountMinor: 1100,
      currency: "USD",
      selection: { Size: "L" },
    });
    expect(selected.statusCode).toBe(200);
    current = (await detail(id)).variants[0];
    expect(current?.selection).toEqual({ Size: "L" });
  });

  it("rejects a compare-at price that is not above the price (422, field issue)", async () => {
    const id = await createProduct();
    const variant = (await detail(id)).variants[0];
    if (variant === undefined) throw new Error("fixture failed");
    const res = await post(`/products/${id}/variants/${variant.id}`, {
      sku: variant.sku,
      priceAmountMinor: 1000,
      currency: "USD",
      compareAtAmountMinor: 900,
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { code: string; fields: { field: string }[] };
    expect(body.code).toBe("VALIDATION");
    expect(body.fields.map((f) => f.field)).toContain("compareAtAmountMinor");
  });

  it("unlists a published product", async () => {
    const id = await createProduct();
    expect((await post(`/products/${id}/publish`)).statusCode).toBe(200);
    const res = await post(`/products/${id}/unlist`);
    expect(res.statusCode).toBe(200);
    expect((await detail(id)).status).toBe("unlisted");
  });

  it("boundary validation still rejects bad attribute values (zod, 422)", async () => {
    const id = await createProduct();
    const variant = (await detail(id)).variants[0];
    if (variant === undefined) throw new Error("fixture failed");
    for (const bad of [
      { weightGrams: -5 },
      { costAmountMinor: 1.5 },
      { requiresShipping: "yes" },
    ]) {
      const res = await post(`/products/${id}/variants/${variant.id}`, {
        sku: variant.sku,
        priceAmountMinor: 1000,
        currency: "USD",
        ...bad,
      });
      expect(res.statusCode).toBe(422);
    }
    expect((await post(`/products/${id}`, { name: "x", slug: "x", tags: [1] })).statusCode).toBe(
      422,
    );
  });
});

describe("staff unlist route — permission (Plan 2C-1)", () => {
  it("requires products:publish (403 without it)", async () => {
    const app = await buildApp({
      authorize: async (_principal, permission) => permission !== "products:publish",
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/products/some-id/unlist",
        headers: authed,
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { code: string }).code).toBe("FORBIDDEN");
    } finally {
      await app.close();
    }
  });
});
