import { describe, expect, it } from "vitest";
import { wireCatalog, type WiredCatalog } from "@platform/catalog";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePricing, type WiredPricing } from "@platform/pricing";
import type { WiredAdmin } from "../composition";
import { publicCatalogRoutes } from "./public-catalog-routes";

/**
 * Regression guard for the public storefront read surface.
 *
 * The routes' `list()` use cases return `Paginated<TAggregate>` — real domain entities. `Entity`
 * declares `props`/`_id` as `protected`, which TypeScript erases at runtime, so Fastify's
 * `JSON.stringify` previously wrote the aggregate's internals straight to anonymous callers:
 * `_domainEvents` (the unpublished domain-event stream), `_version` (the optimistic lock),
 * `deleted`, and every real field buried under a nested `props`. These tests pin the DTO boundary
 * that now stands between the aggregates and the wire.
 *
 * The fixtures drive the REAL `wireCatalog` composition (in-memory branch) rather than
 * hand-assembling aggregates — `Slug`/`Sku`/`Variant` are deliberately not part of
 * `@platform/catalog`'s public surface, and going through the actual controllers is what makes the
 * "no internals on the wire" assertion meaningful in the first place.
 */

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

function catalogFixture(): WiredCatalog {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireCatalog({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

function pricingFixture(): WiredPricing {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `price-id-${(n += 1)}` };
  return wirePricing({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

function unwrap<T>(response: { status: number; body: unknown }, action: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}

/** Only `publicReads` is exercised; the rest of `WiredAdmin` is irrelevant to these routes. */
function stubAdmin(catalog: WiredCatalog, pricing?: WiredPricing): WiredAdmin {
  return {
    publicReads: {
      products: catalog.products,
      categories: catalog.categories,
      collections: catalog.collections,
      ...(pricing === undefined ? {} : { prices: pricing.prices }),
    },
  } as unknown as WiredAdmin;
}

async function invoke(
  admin: WiredAdmin,
  path: string,
  params?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const route = publicCatalogRoutes(admin).find((r) => r.path === path);
  if (route === undefined) throw new Error(`no public route at ${path}`);
  return (await route.handle({
    body: undefined,
    params: params ?? undefined,
    query: {},
    context: {
      tenantId: "tenant-local",
      principal: { id: "anon", kind: "staff", roles: [] },
      requestId: "req-1",
    },
  } as never)) as { status: number; body: unknown };
}

describe("public catalog routes — DTO boundary", () => {
  it("projects a published collection to a flat, primitive-only DTO", async () => {
    const catalog = catalogFixture();
    const product = unwrap<{ id: string }>(
      await catalog.products.create({
        sku: "WB-001",
        name: "Wooden Building Blocks",
        slug: "wooden-building-blocks",
        variants: [{ sku: "WB-001-STD", priceAmountMinor: 2999, currency: "USD" }],
        tenantId: "tenant-local",
      }),
      "create product",
    );
    const collection = unwrap<{ id: string }>(
      await catalog.collections.create({
        name: "Featured Toys",
        slug: "featured-toys",
        tenantId: "tenant-local",
      }),
      "create collection",
    );
    unwrap(
      await catalog.collections.addProduct({
        collectionId: collection.id,
        productId: product.id,
        tenantId: "tenant-local",
      }),
      "add product to collection",
    );
    unwrap(
      await catalog.collections.publish({ collectionId: collection.id, tenantId: "tenant-local" }),
      "publish collection",
    );

    const response = await invoke(stubAdmin(catalog), "/public/collections");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [
        {
          id: collection.id,
          name: "Featured Toys",
          slug: "featured-toys",
          status: "published",
          productIds: [product.id],
        },
      ],
      // `pageInfo` is carried through verbatim — mapping the page must not disturb the cursor.
      pageInfo: { hasNextPage: false, endCursor: collection.id },
    });
  });

  it("never puts aggregate internals on the wire (props / _id / _domainEvents / _version / deleted)", async () => {
    const catalog = catalogFixture();
    unwrap(
      await catalog.collections.create({
        name: "Featured Toys",
        slug: "featured-toys",
        tenantId: "tenant-local",
      }),
      "create collection",
    );

    const serialized = JSON.stringify(await invoke(stubAdmin(catalog), "/public/collections"));

    for (const leak of ["props", "_id", "_domainEvents", "_version", "deleted"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("flattens a product's Sku/Slug/PublishState value objects and its variants' Money", async () => {
    const catalog = catalogFixture();
    const product = unwrap<{ id: string }>(
      await catalog.products.create({
        sku: "WB-001",
        name: "Wooden Building Blocks",
        slug: "wooden-building-blocks",
        variants: [{ sku: "WB-001-STD", priceAmountMinor: 2999, currency: "USD" }],
        tenantId: "tenant-local",
      }),
      "create product",
    );

    const response = await invoke(stubAdmin(catalog), "/public/products");
    const body = response.body as { items: readonly Record<string, unknown>[] };

    // The exact shape apps/storefront/src/lib/runtime-api.ts declares as ProductSummary — before
    // this boundary existed, `name`/`variants` were undefined here and the storefront's
    // `product.variants[0]` threw, 500-ing the home page the moment the API was connected.
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: product.id,
      sku: "WB-001",
      name: "Wooden Building Blocks",
      slug: "wooden-building-blocks",
      status: "draft",
    });
    expect(body.items[0]?.variants).toEqual([
      { id: expect.any(String), sku: "WB-001-STD", priceAmountMinor: 2999, currency: "USD" },
    ]);
  });

  it("T5.15: forwards a `query` querystring param to the substring product search", async () => {
    const catalog = catalogFixture();
    await catalog.products.create({
      sku: "WB-001",
      name: "Wooden Building Blocks",
      slug: "wooden-building-blocks",
      variants: [{ sku: "WB-001-STD", priceAmountMinor: 2999, currency: "USD" }],
      tenantId: "tenant-local",
    });
    await catalog.products.create({
      sku: "MC-001",
      name: "Metal Car",
      slug: "metal-car",
      variants: [{ sku: "MC-001-STD", priceAmountMinor: 1999, currency: "USD" }],
      tenantId: "tenant-local",
    });

    const route = publicCatalogRoutes(stubAdmin(catalog)).find(
      (r) => r.path === "/public/products",
    );
    if (route === undefined) throw new Error("no /public/products route");
    const response = (await route.handle({
      body: undefined,
      params: undefined,
      query: { query: "wooden" },
      context: {
        tenantId: "tenant-local",
        principal: { id: "anon", kind: "staff", roles: [] },
        requestId: "req-1",
      },
    } as never)) as { status: number; body: unknown };

    expect(response.status).toBe(200);
    const body = response.body as { items: readonly { slug: string }[] };
    expect(body.items.map((item) => item.slug)).toEqual(["wooden-building-blocks"]);
  });

  it("passes a non-2xx body through untouched — an error envelope is not a page", async () => {
    const envelope = { code: "VALIDATION", message: "bad cursor" };
    const admin = {
      publicReads: {
        collections: { list: async () => ({ status: 422, body: envelope }) },
      },
    } as unknown as WiredAdmin;

    const response = await invoke(admin, "/public/collections");

    expect(response.status).toBe(422);
    expect(response.body).toBe(envelope);
  });

  it("exposes exactly the eight read routes, all public, all GET", () => {
    const routes = publicCatalogRoutes(stubAdmin(catalogFixture()));

    expect(routes.map((r) => r.path).sort()).toEqual([
      "/public/categories",
      "/public/collections",
      "/public/collections/:slug",
      "/public/collections/:slug/products",
      "/public/inventory",
      "/public/prices",
      "/public/products",
      "/public/products/:slug",
    ]);
    expect(routes.every((r) => r.method === "GET" && r.public === true)).toBe(true);
  });

  describe("GET /public/collections/:slug/products (T5.20)", () => {
    it("returns the collection's published member products, in curated order, as flat product DTOs", async () => {
      const catalog = catalogFixture();
      const first = unwrap<{ id: string }>(
        await catalog.products.create({
          sku: "WB-001",
          name: "Wooden Building Blocks",
          slug: "wooden-building-blocks",
          variants: [{ sku: "WB-001-STD", priceAmountMinor: 2999, currency: "USD" }],
          tenantId: "tenant-local",
        }),
        "create product",
      );
      unwrap(
        await catalog.products.publish({ productId: first.id, tenantId: "tenant-local" }),
        "publish product",
      );
      const second = unwrap<{ id: string }>(
        await catalog.products.create({
          sku: "MC-001",
          name: "Metal Car",
          slug: "metal-car",
          variants: [{ sku: "MC-001-STD", priceAmountMinor: 1999, currency: "USD" }],
          tenantId: "tenant-local",
        }),
        "create product",
      );
      unwrap(
        await catalog.products.publish({ productId: second.id, tenantId: "tenant-local" }),
        "publish product",
      );
      const collection = unwrap<{ id: string }>(
        await catalog.collections.create({
          name: "Featured Toys",
          slug: "featured-toys",
          tenantId: "tenant-local",
        }),
        "create collection",
      );
      // Added in reverse — the curated order (second, then first) must be preserved on the wire.
      unwrap(
        await catalog.collections.addProduct({
          collectionId: collection.id,
          productId: second.id,
          tenantId: "tenant-local",
        }),
        "add second product",
      );
      unwrap(
        await catalog.collections.addProduct({
          collectionId: collection.id,
          productId: first.id,
          tenantId: "tenant-local",
        }),
        "add first product",
      );
      unwrap(
        await catalog.collections.publish({
          collectionId: collection.id,
          tenantId: "tenant-local",
        }),
        "publish collection",
      );

      const response = await invoke(stubAdmin(catalog), "/public/collections/:slug/products", {
        slug: "featured-toys",
      });

      expect(response.status).toBe(200);
      const body = response.body as { items: readonly { id: string; slug: string }[] };
      expect(body.items.map((item) => item.id)).toEqual([second.id, first.id]);
      expect(body.items[0]).toMatchObject({ slug: "metal-car" });
    });

    it("404s for a slug that doesn't exist", async () => {
      const response = await invoke(
        stubAdmin(catalogFixture()),
        "/public/collections/:slug/products",
        { slug: "no-such-collection" },
      );

      expect(response.status).toBe(404);
    });

    it("404s for an unpublished (draft) collection — never leaks its membership", async () => {
      const catalog = catalogFixture();
      unwrap(
        await catalog.collections.create({
          name: "Featured Toys",
          slug: "featured-toys",
          tenantId: "tenant-local",
        }),
        "create collection",
      );
      // Left as draft — never published.

      const response = await invoke(stubAdmin(catalog), "/public/collections/:slug/products", {
        slug: "featured-toys",
      });

      expect(response.status).toBe(404);
    });

    it("silently skips a member product that isn't published", async () => {
      const catalog = catalogFixture();
      const published = unwrap<{ id: string }>(
        await catalog.products.create({
          sku: "WB-001",
          name: "Wooden Building Blocks",
          slug: "wooden-building-blocks",
          variants: [{ sku: "WB-001-STD", priceAmountMinor: 2999, currency: "USD" }],
          tenantId: "tenant-local",
        }),
        "create product",
      );
      unwrap(
        await catalog.products.publish({ productId: published.id, tenantId: "tenant-local" }),
        "publish product",
      );
      const draft = unwrap<{ id: string }>(
        await catalog.products.create({
          sku: "MC-001",
          name: "Metal Car",
          slug: "metal-car",
          variants: [{ sku: "MC-001-STD", priceAmountMinor: 1999, currency: "USD" }],
          tenantId: "tenant-local",
        }),
        "create draft product",
      );
      // Left as draft — never published.
      const collection = unwrap<{ id: string }>(
        await catalog.collections.create({
          name: "Featured Toys",
          slug: "featured-toys",
          tenantId: "tenant-local",
        }),
        "create collection",
      );
      unwrap(
        await catalog.collections.addProduct({
          collectionId: collection.id,
          productId: published.id,
          tenantId: "tenant-local",
        }),
        "add published product",
      );
      unwrap(
        await catalog.collections.addProduct({
          collectionId: collection.id,
          productId: draft.id,
          tenantId: "tenant-local",
        }),
        "add draft product",
      );
      unwrap(
        await catalog.collections.publish({
          collectionId: collection.id,
          tenantId: "tenant-local",
        }),
        "publish collection",
      );

      const response = await invoke(stubAdmin(catalog), "/public/collections/:slug/products", {
        slug: "featured-toys",
      });

      expect(response.status).toBe(200);
      const body = response.body as { items: readonly { id: string }[] };
      expect(body.items.map((item) => item.id)).toEqual([published.id]);
    });
  });

  it("a draft price is never served by /public/prices — the route's own contract is published-only", async () => {
    const pricing = pricingFixture();
    const created = unwrap<{ id: string }>(
      await pricing.prices.create({
        priceListId: "price-list-1",
        productId: "product-1",
        amountMinor: 2999,
        currency: "USD",
      }),
      "create price",
    );
    // Left as draft — never published.

    const response = await invoke(stubAdmin(catalogFixture(), pricing), "/public/prices");

    expect(response.status).toBe(200);
    const body = response.body as { items: readonly { id: string }[] };
    expect(body.items.map((price) => price.id)).not.toContain(created.id);
    expect(body.items).toEqual([]);
  });

  it("a published price is served by /public/prices, a draft sibling is filtered out", async () => {
    const pricing = pricingFixture();
    const draft = unwrap<{ id: string }>(
      await pricing.prices.create({
        priceListId: "price-list-1",
        productId: "product-1",
        amountMinor: 2999,
        currency: "USD",
      }),
      "create draft price",
    );
    const published = unwrap<{ id: string }>(
      await pricing.prices.create({
        priceListId: "price-list-1",
        productId: "product-2",
        amountMinor: 1999,
        currency: "USD",
      }),
      "create published price",
    );
    unwrap(await pricing.prices.publish({ priceId: published.id }), "publish price");

    const response = await invoke(stubAdmin(catalogFixture(), pricing), "/public/prices");

    expect(response.status).toBe(200);
    const body = response.body as { items: readonly { id: string; status: string }[] };
    expect(body.items.map((price) => price.id)).toEqual([published.id]);
    expect(body.items.map((price) => price.id)).not.toContain(draft.id);
    expect(body.items.every((price) => price.status === "published")).toBe(true);
  });
});
