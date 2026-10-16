import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  Authenticator,
  AuthenticatedIdentity,
  Cache,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { ObjectStoragePort } from "@platform/media";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";
import { httpDriver, seedCatalogProduct } from "./testing/seed-catalog";
import { httpStockDriver, seedStock } from "./testing/seed-stock";

/**
 * Plan 2C-3 — the picture on every order, cart and checkout line: the variant's image, else the
 * product's featured image, resolved when the line is READ. Driven through the real pipeline:
 * upload → product → attach → variant image → cart → checkout → complete → staff reads the order.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
const BASE = "https://cdn.example.test/media";
const TENANT = "t-1";

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
  const authenticator: Authenticator = {
    verify: async (token) => (token === "good" ? staff : null),
  };
  return { cache, idempotencyKeys, rateLimiter, authenticator };
}

interface Line {
  productId: string;
  variantId: string | null;
  imageUrl: string | null;
}

describe("images on order, cart and checkout lines (Plan 2C-3)", () => {
  let app: FastifyInstance;
  let n = 0;

  beforeAll(async () => {
    const fx = infra();
    app = await createAdminHttpApi({
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => `${crypto.randomUUID()}-${(n += 1)}` },
      clock,
      auditTrail: new InMemoryAuditTrail(),
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
      objectStorage: storage,
      publicMediaBaseUrl: BASE,
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const staffHeaders = {
    authorization: "Bearer good",
    "x-tenant-id": TENANT,
    "content-type": "application/json",
  };
  const shopper = { "x-tenant-id": TENANT, "content-type": "application/json" };
  const send = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    headers: Record<string, string>,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  function ok<T>(res: { statusCode: number; body: string; json: () => unknown }, what: string): T {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`${what} failed (${res.statusCode}): ${res.body}`);
    }
    return res.json() as T;
  }
  async function upload(): Promise<{ id: string; url: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/media/uploads",
      headers: { ...staffHeaders, "content-type": "image/png" },
      payload: png(),
    });
    return ok(res, "upload");
  }

  /** A published product with two variants; A has no image of its own, B has the second picture. */
  async function seed(sku: string) {
    const driver = httpDriver(async (method, url, payload) =>
      method === "GET"
        ? send("GET", url, staffHeaders)
        : send("POST", url, staffHeaders, payload ?? {}),
    );
    const product = await seedCatalogProduct(driver, {
      sku,
      currency: "USD",
      variants: [
        { sku: `${sku}-A`, priceAmountMinor: 1500 },
        { sku: `${sku}-B`, priceAmountMinor: 1800 },
      ],
    });
    const [first, second] = [await upload(), await upload()] as [
      { id: string; url: string },
      { id: string; url: string },
    ];
    for (const image of [first, second]) {
      ok(
        await send("POST", `/products/${product.productId}/media`, staffHeaders, {
          assetId: image.id,
        }),
        "attach",
      );
    }
    const [a, b] = product.variants as unknown as [{ id: string }, { id: string }];
    ok(
      await send("PUT", `/products/${product.productId}/variants/${b.id}/image`, staffHeaders, {
        mediaId: second.id,
      }),
      "variant image",
    );
    await seedStock(
      httpStockDriver(async (method, url, payload) =>
        method === "GET"
          ? send("GET", url, staffHeaders)
          : send("POST", url, staffHeaders, payload ?? {}),
      ),
      { productId: product.productId, variantId: a.id, quantity: 50 },
    );
    await seedStock(
      httpStockDriver(async (method, url, payload) =>
        method === "GET"
          ? send("GET", url, staffHeaders)
          : send("POST", url, staffHeaders, payload ?? {}),
      ),
      { productId: product.productId, variantId: b.id, quantity: 50 },
    );
    return { productId: product.productId, a: a.id, b: b.id, first, second };
  }

  const address = { line1: "1 Main St", city: "Cairo", postalCode: "00000", country: "US" };

  async function checkoutWith(
    sessionRef: string,
    lines: { productId: string; variantId: string }[],
  ) {
    const cart = ok<{ id: string }>(
      await send("POST", "/public/carts", shopper, { sessionRef, currency: "USD" }),
      "cart",
    );
    for (const line of lines) {
      ok(
        await send("POST", `/public/carts/${cart.id}/items`, shopper, {
          sessionRef,
          productId: line.productId,
          variantId: line.variantId,
          quantity: 1,
        }),
        "add",
      );
    }
    const started = ok<{ id: string }>(
      await send("POST", "/public/checkouts", shopper, {
        sessionRef,
        cartRef: cart.id,
        currency: "USD",
      }),
      "checkout",
    );
    const base = `/public/checkouts/${started.id}`;
    ok(await send("POST", `${base}/items`, shopper, { sessionRef, cartId: cart.id }), "load");
    ok(await send("POST", `${base}/billing-address`, shopper, { sessionRef, ...address }), "bill");
    ok(await send("POST", `${base}/shipping-address`, shopper, { sessionRef, ...address }), "ship");
    ok(
      await send("POST", `${base}/shipping-selection`, shopper, { sessionRef, method: "standard" }),
      "m",
    );
    ok(
      await send("POST", `${base}/payment-selection`, shopper, {
        sessionRef,
        paymentMethodRef: "pm_1",
        provider: "stripe",
      }),
      "pay",
    );
    ok(await send("POST", `${base}/contact`, shopper, { sessionRef, email: "g@example.com" }), "c");
    ok(await send("POST", `${base}/recalculate`, shopper, { sessionRef }), "recalc");
    return { cartId: cart.id, checkoutId: started.id, base };
  }

  it("shows the variant's image, else the featured one, on the cart and the checkout", async () => {
    const p = await seed("IMGL-1");
    const flow = await checkoutWith("sess-1", [
      { productId: p.productId, variantId: p.a },
      { productId: p.productId, variantId: p.b },
    ]);

    const cart = ok<{ items: Line[] }>(
      await send("GET", `/public/carts/${flow.cartId}?sessionRef=sess-1`, shopper),
      "get cart",
    );
    const byVariant = (lines: Line[], id: string) => lines.find((l) => l.variantId === id)!;
    expect(byVariant(cart.items, p.a).imageUrl).toBe(p.first.url);
    expect(byVariant(cart.items, p.b).imageUrl).toBe(p.second.url);

    const checkout = ok<{ items: Line[] }>(
      await send("GET", `/public/checkouts/${flow.checkoutId}?sessionRef=sess-1`, shopper),
      "get checkout",
    );
    expect(byVariant(checkout.items, p.a).imageUrl).toBe(p.first.url);
    expect(byVariant(checkout.items, p.b).imageUrl).toBe(p.second.url);
  });

  it("shows the same pictures on the order staff read, and a placeholder once the product is deleted", async () => {
    const p = await seed("IMGL-2");
    const flow = await checkoutWith("sess-2", [
      { productId: p.productId, variantId: p.a },
      { productId: p.productId, variantId: p.b },
    ]);
    const done = ok<{ orderRef: string }>(
      await send("POST", `${flow.base}/complete`, shopper, {
        sessionRef: "sess-2",
        idempotencyKey: "idem-sess-2",
      }),
      "complete",
    );

    const order = ok<{ items: { variantRef: string | null; imageUrl: string | null }[] }>(
      await send("GET", `/orders/${done.orderRef}`, staffHeaders),
      "get order",
    );
    const imageOf = (id: string) => order.items.find((i) => i.variantRef === id)!.imageUrl;
    expect(imageOf(p.a)).toBe(p.first.url);
    expect(imageOf(p.b)).toBe(p.second.url);

    ok(await send("POST", `/products/${p.productId}/delete`, staffHeaders, {}), "delete");
    const after = ok<{ items: { imageUrl: string | null }[] }>(
      await send("GET", `/orders/${done.orderRef}`, staffHeaders),
      "get order again",
    );
    expect(after.items.every((i) => i.imageUrl === null)).toBe(true);
  });
});
