import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import type { Cache, IdempotencyKeyStore } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

let app: FastifyInstance;
const headers = (tenant = "t-1", token = "admin-token") => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
});
async function post(path: string, payload?: object, tenant = "t-1", token = "admin-token") {
  return app.inject({
    method: "POST",
    url: `/api/v1${path}`,
    headers: { ...headers(tenant, token), "idempotency-key": crypto.randomUUID() },
    ...(payload === undefined ? {} : { payload }),
  });
}
async function get(path: string, tenant = "t-1", token = "admin-token") {
  return app.inject({ method: "GET", url: `/api/v1${path}`, headers: headers(tenant, token) });
}
async function collection() {
  const slug = crypto.randomUUID();
  const res = await post("/collections", { name: "Summer", slug });
  expect(res.statusCode).toBe(201);
  return { id: res.json().id as string, slug };
}
async function product() {
  const suffix = crypto.randomUUID();
  const res = await post("/products", {
    sku: `P-${suffix}`,
    name: `Product ${suffix}`,
    slug: `p-${suffix}`,
    variants: [{ sku: `V-${suffix}`, priceAmountMinor: 1000, currency: "USD" }],
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}
beforeAll(async () => {
  const store = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
  };
  const claims = new Set<string>();
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key) => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  app = await createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => crypto.randomUUID() },
    clock: { now: () => new Date("2026-07-05T00:00:00Z") },
    auditTrail: new InMemoryAuditTrail(),
    authenticator: {
      verify: async (token) =>
        token === "admin-token"
          ? { id: "staff-1", kind: "staff", roles: ["admin"] }
          : token === "viewer-token"
            ? { id: "staff-2", kind: "staff", roles: ["viewer"] }
            : null,
    },
    accessControl: new RoleTableAccessControl(),
    rateLimiter: { consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }) },
    idempotencyKeys,
    responseCache: cache,
  });
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  expect.hasAssertions();
});

describe("collections admin routes", () => {
  it("creates and lists a draft with a product count", async () => {
    const { id, slug } = await collection();
    const list = await get("/collections");
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toContainEqual(
      expect.objectContaining({ id, name: "Summer", slug, status: "draft", productCount: 0 }),
    );
  });
  it("returns conflict for a duplicate slug", async () => {
    const { slug } = await collection();
    const res = await post("/collections", { name: "Other", slug });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });
  it("validates empty names at the transport boundary", async () => {
    const res = await post("/collections", { name: "", slug: "x" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("VALIDATION");
  });
  it("returns not found for absent or foreign-tenant collections", async () => {
    const { id } = await collection();
    for (const res of [
      await get(`/collections/${crypto.randomUUID()}`),
      await get(`/collections/${id}`, "t-2"),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    }
  });
  it("returns a business rule conflict on second publish", async () => {
    const { id } = await collection();
    expect((await post(`/collections/${id}/publish`)).statusCode).toBe(200);
    const res = await post(`/collections/${id}/publish`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BUSINESS_RULE");
  });
  it("allows viewers to read but not create", async () => {
    expect((await get("/collections", "t-1", "viewer-token")).statusCode).toBe(200);
    expect(
      (await post("/collections", { name: "X", slug: "x" }, "t-1", "viewer-token")).statusCode,
    ).toBe(403);
  });
  it("returns ordered draft and published members in pages, preserving deleted members", async () => {
    const { id } = await collection();
    const a = await product();
    const b = await product();
    expect((await post(`/products/${a}/publish`)).statusCode).toBe(200);
    for (const productId of [b, a])
      expect((await post(`/collections/${id}/products`, { productId })).statusCode).toBe(200);
    const first = await get(`/collections/${id}/products?first=1`);
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toEqual([
      expect.objectContaining({ productId: b, status: "draft", position: 0, missing: false }),
    ]);
    expect(first.json().pageInfo.hasNextPage).toBe(true);
    const second = await get(
      `/collections/${id}/products?first=1&after=${first.json().pageInfo.endCursor}`,
    );
    expect(second.json().items).toEqual([
      expect.objectContaining({ productId: a, status: "published", position: 1, missing: false }),
    ]);
    expect(second.json().pageInfo.hasNextPage).toBe(false);
    expect((await post(`/products/${b}/delete`)).statusCode).toBe(200);
    const missing = await get(`/collections/${id}/products`);
    expect(missing.json().items[0]).toEqual({
      productId: b,
      position: 0,
      name: null,
      status: null,
      missing: true,
    });
  });
  it("accepts a full 501-member reorder and rejects omissions and duplicates", async () => {
    const { id } = await collection();
    const ids: string[] = [];
    for (let i = 0; i < 501; i++) {
      const productId = await product();
      ids.push(productId);
      expect((await post(`/collections/${id}/products`, { productId })).statusCode).toBe(200);
    }
    expect(
      (await post(`/collections/${id}/reorder`, { productIds: [...ids].reverse() })).statusCode,
    ).toBe(200);
    for (const productIds of [ids.slice(1), [...ids.slice(1), ids[1]]]) {
      const res = await post(`/collections/${id}/reorder`, { productIds });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("BUSINESS_RULE");
    }
  }, 120000);
});
