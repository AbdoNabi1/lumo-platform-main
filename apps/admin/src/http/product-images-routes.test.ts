import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
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
import type { ObjectStoragePort } from "@platform/media";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

/**
 * Plan 2C-3 — images in every product read, over the real HTTP stack: the staff detail and list, and the
 * public by-slug and list. Variant images, order, the tenant fence on attach, and "a missing picture is
 * never a 500".
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
const BASE = "https://cdn.example.test/media";

const png = (): Buffer =>
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 7,
    0, 0, 0, 5, 8, 6, 0, 0, 0,
  ]);

const storage: ObjectStoragePort = {
  persistent: true,
  exists: async () => true,
  getDownloadUrl: async (key) => `https://signed.example/${key}`,
  put: async () => undefined,
};

function headers(tenant: string, contentType = "application/json") {
  return { authorization: "Bearer good", "x-tenant-id": tenant, "content-type": contentType };
}

function buildApp(options: { publicMediaBaseUrl?: string } = {}): Promise<FastifyInstance> {
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
  const idGenerator: IdGenerator = { generate: () => `${crypto.randomUUID()}-${(n += 1)}` };
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    objectStorage: storage,
    ...(options.publicMediaBaseUrl === undefined
      ? {}
      : { publicMediaBaseUrl: options.publicMediaBaseUrl }),
  });
}

interface Image {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}
interface Detail {
  media: Image[];
  mediaAssetIds: string[];
  variants: { id: string; imageId: string | null }[];
}

describe("product images in the staff and public reads (Plan 2C-3)", () => {
  let app: FastifyInstance;
  let seq = 0;

  beforeAll(async () => {
    app = await buildApp({ publicMediaBaseUrl: BASE });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    tenant = "t-1",
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headers(tenant),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  async function upload(tenant = "t-1"): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: headers(tenant, "image/png"),
      payload: png(),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  async function product(tenant = "t-1") {
    seq += 1;
    const res = await call("POST", "/products", tenant, {
      sku: `IMG-${seq}`,
      name: `Image product ${seq}`,
      slug: `image-product-${seq}`,
      variants: [
        { sku: `IMG-${seq}-A`, priceAmountMinor: 1000, currency: "EGP" },
        { sku: `IMG-${seq}-B`, priceAmountMinor: 1200, currency: "EGP" },
      ],
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    const detail = (await call("GET", `/products/${id}`, tenant)).json() as Detail;
    return { id, slug: `image-product-${seq}`, variantIds: detail.variants.map((v) => v.id) };
  }
  const attach = (productId: string, assetId: string, tenant = "t-1") =>
    call("POST", `/products/${productId}/media`, tenant, { assetId });
  const detail = async (productId: string, tenant = "t-1") =>
    (await call("GET", `/products/${productId}`, tenant)).json() as Detail;

  it("staff detail lists the media in the merchant's order with url, alt and size, and each variant's image", async () => {
    const p = await product();
    const [a, b, c] = [await upload(), await upload(), await upload()] as [string, string, string];
    for (const id of [a, b, c]) expect((await attach(p.id, id)).statusCode).toBe(201);
    expect(
      (await call("PATCH", `/media/assets/${b}`, "t-1", { alt: "Blue side" })).statusCode,
    ).toBe(200);
    expect(
      (await call("PUT", `/products/${p.id}/media`, "t-1", { assetIds: [c, a, b] })).statusCode,
    ).toBe(200);
    const set = await call("PUT", `/products/${p.id}/variants/${p.variantIds[1]}/image`, "t-1", {
      mediaId: b,
    });
    expect(set.statusCode).toBe(200);

    const d = await detail(p.id);

    expect(d.media.map((m) => m.id)).toEqual([c, a, b]);
    expect(d.mediaAssetIds).toEqual([c, a, b]);
    expect(d.media[2]).toMatchObject({ alt: "Blue side", width: 7, height: 5 });
    expect(d.media[0]!.url.startsWith(`${BASE}/tenants/t-1/product-images/`)).toBe(true);
    expect(d.variants.map((v) => v.imageId)).toEqual([null, b]);
  });

  it("refuses a variant image that is not one of the product's media, and clears it when that media is detached", async () => {
    const p = await product();
    const [a, other] = [await upload(), await upload()] as [string, string];
    await attach(p.id, a);

    const foreign = await call(
      "PUT",
      `/products/${p.id}/variants/${p.variantIds[0]}/image`,
      "t-1",
      {
        mediaId: other,
      },
    );
    expect(foreign.statusCode).toBe(409);

    await call("PUT", `/products/${p.id}/variants/${p.variantIds[0]}/image`, "t-1", { mediaId: a });
    expect((await detail(p.id)).variants[0]!.imageId).toBe(a);
    expect((await call("DELETE", `/products/${p.id}/media/${a}`)).statusCode).toBe(200);
    expect((await detail(p.id)).variants[0]!.imageId).toBeNull();
    const cleared = await call(
      "PUT",
      `/products/${p.id}/variants/${p.variantIds[0]}/image`,
      "t-1",
      {
        mediaId: null,
      },
    );
    expect(cleared.statusCode).toBe(200);
  });

  it("refuses to attach another tenant's asset (404, same as an unknown id)", async () => {
    const theirs = await upload("t-2");
    const mine = await product("t-1");
    const foreign = await attach(mine.id, theirs, "t-1");
    const unknown = await attach(mine.id, "does-not-exist", "t-1");
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect((await detail(mine.id)).media).toEqual([]);
  });

  it("staff list carries each row's featured image (or null)", async () => {
    const withImage = await product();
    const without = await product();
    const first = await upload();
    await attach(withImage.id, first);

    const res = await call("GET", "/products?first=100");
    const items = (res.json() as { items: { id: string; featuredImage: Image | null }[] }).items;
    expect(items.find((i) => i.id === withImage.id)!.featuredImage?.id).toBe(first);
    expect(items.find((i) => i.id === without.id)!.featuredImage).toBeNull();
  });

  it("public by-slug and list expose media, variant image ids, featured and hover images — and never a storage key", async () => {
    const p = await product();
    const [a, b] = [await upload(), await upload()] as [string, string];
    await attach(p.id, a);
    await attach(p.id, b);
    await call("PUT", `/products/${p.id}/variants/${p.variantIds[0]}/image`, "t-1", { mediaId: b });
    expect((await call("POST", `/products/${p.id}/publish`)).statusCode).toBe(200);

    const one = await call("GET", `/public/products/${p.slug}`);
    const body = one.json() as {
      media: Image[];
      variants: { imageId: string | null }[];
    };
    expect(body.media.map((m) => m.id)).toEqual([a, b]);
    expect(body.variants.map((v) => v.imageId)).toEqual([b, null]);
    for (const image of body.media) {
      expect(Object.keys(image).sort()).toEqual(["alt", "height", "id", "url", "width"]);
    }
    expect(one.body).not.toMatch(/storageKey|storage_key/);

    const list = await call("GET", "/public/products?first=100");
    const row = (
      list.json() as {
        items: { id: string; featuredImage: Image | null; hoverImage: Image | null }[];
      }
    ).items.find((i) => i.id === p.id)!;
    expect(row.featuredImage?.id).toBe(a);
    expect(row.hoverImage?.id).toBe(b);
    expect(list.body).not.toMatch(/storageKey|storage_key/);
  });

  it("a picture that went missing is skipped, never a 500", async () => {
    const p = await product();
    const a = await upload();
    await attach(p.id, a);
    expect((await call("POST", `/media/assets/${a}/archive`)).statusCode).toBe(200);

    const d = await call("GET", `/products/${p.id}`);
    expect(d.statusCode).toBe(200);
    expect((d.json() as Detail).media).toEqual([]);
    expect((d.json() as Detail).mediaAssetIds).toEqual([a]);
  });

  it("without a public base url the reads still work, with no pictures", async () => {
    const bare = await buildApp();
    try {
      const created = await bare.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: headers("t-1"),
        payload: {
          sku: "BARE-1",
          name: "Bare",
          slug: "bare-1",
          variants: [{ sku: "BARE-1-A", priceAmountMinor: 100, currency: "EGP" }],
        },
      });
      const id = (created.json() as { id: string }).id;
      const res = await bare.inject({
        method: "GET",
        url: `/api/v1/products/${id}`,
        headers: headers("t-1"),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as Detail).media).toEqual([]);
    } finally {
      await bare.close();
    }
  });
});
