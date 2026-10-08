import { describe, expect, it } from "vitest";
import { wireCatalog, type WiredCatalog } from "@platform/catalog";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireInventory } from "@platform/inventory";
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
    // Plan 2C-1: the public list shows listed (published) products only, so publish it first.
    unwrap(
      await catalog.products.publish({ productId: product.id, tenantId: "tenant-local" }),
      "publish product",
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
      status: "published",
    });
    expect(body.items[0]?.options).toEqual([]);
    expect(body.items[0]?.variants).toEqual([
      {
        id: expect.any(String),
        sku: "WB-001-STD",
        priceAmountMinor: 2999,
        currency: "USD",
        selection: null,
        title: null,
        compareAtAmountMinor: null,
        sellableWhenOutOfStock: false,
      },
    ]);
  });

  it("T5.15: forwards a `query` querystring param to the substring product search", async () => {
    const catalog = catalogFixture();
    // Plan 2C-1: search, like the list, shows listed (published) products only.
    for (const created of [
      await catalog.products.create({
        sku: "WB-001",
        name: "Wooden Building Blocks",
        slug: "wooden-building-blocks",
        variants: [{ sku: "WB-001-STD", priceAmountMinor: 2999, currency: "USD" }],
        tenantId: "tenant-local",
      }),
      await catalog.products.create({
        sku: "MC-001",
        name: "Metal Car",
        slug: "metal-car",
        variants: [{ sku: "MC-001-STD", priceAmountMinor: 1999, currency: "USD" }],
        tenantId: "tenant-local",
      }),
    ]) {
      const { id } = unwrap<{ id: string }>(created, "create product");
      unwrap(
        await catalog.products.publish({ productId: id, tenantId: "tenant-local" }),
        "publish product",
      );
    }

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
        tenantId: "tenant-local",
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
        tenantId: "tenant-local",
        priceListId: "price-list-1",
        productId: "product-1",
        amountMinor: 2999,
        currency: "USD",
      }),
      "create draft price",
    );
    const published = unwrap<{ id: string }>(
      await pricing.prices.create({
        tenantId: "tenant-local",
        priceListId: "price-list-1",
        productId: "product-2",
        amountMinor: 1999,
        currency: "USD",
      }),
      "create published price",
    );
    unwrap(
      await pricing.prices.publish({ tenantId: "tenant-local", priceId: published.id }),
      "publish price",
    );

    const response = await invoke(stubAdmin(catalogFixture(), pricing), "/public/prices");

    expect(response.status).toBe(200);
    const body = response.body as { items: readonly { id: string; status: string }[] };
    expect(body.items.map((price) => price.id)).toEqual([published.id]);
    expect(body.items.map((price) => price.id)).not.toContain(draft.id);
    expect(body.items.every((price) => price.status === "published")).toBe(true);
  });
});

describe("public catalog routes — only listed products are listed, sellable ones open by slug (Plan 2C-1)", () => {
  const tenantId = "tenant-local";

  async function seed(
    catalog: WiredCatalog,
    slug: string,
    state: "draft" | "published" | "unlisted" | "archived",
  ) {
    const created = unwrap<{ id: string }>(
      await catalog.products.create({
        sku: `SKU-${slug}`,
        name: `Product ${slug}`,
        slug,
        variants: [{ sku: `SKU-${slug}-V`, priceAmountMinor: 1000, currency: "USD" }],
        tenantId,
      }),
      "create product",
    );
    if (state === "published" || state === "unlisted") {
      unwrap(await catalog.products.publish({ productId: created.id, tenantId }), "publish");
    }
    if (state === "unlisted") {
      unwrap(await catalog.products.unlist({ productId: created.id, tenantId }), "unlist");
    }
    if (state === "archived") {
      unwrap(await catalog.products.archive({ productId: created.id, tenantId }), "archive");
    }
    return created.id;
  }

  async function seedAllStates(): Promise<WiredCatalog> {
    const catalog = catalogFixture();
    await seed(catalog, "p-published", "published");
    await seed(catalog, "p-draft", "draft");
    await seed(catalog, "p-unlisted", "unlisted");
    await seed(catalog, "p-archived", "archived");
    return catalog;
  }

  async function invokeList(admin: WiredAdmin, query: Record<string, string>) {
    const route = publicCatalogRoutes(admin).find((r) => r.path === "/public/products");
    if (route === undefined) throw new Error("no /public/products route");
    return (await route.handle({
      body: undefined,
      params: undefined,
      query,
      context: { tenantId, principal: { id: "anon", kind: "staff", roles: [] }, requestId: "r" },
    } as never)) as { status: number; body: unknown };
  }

  it("the list returns the published product, not a draft, unlisted or archived one", async () => {
    const response = await invoke(stubAdmin(await seedAllStates()), "/public/products");
    expect(response.status).toBe(200);
    const body = response.body as { items: readonly { slug: string }[] };
    expect(body.items.map((item) => item.slug)).toEqual(["p-published"]);
  });

  it("search applies the same rule", async () => {
    const response = await invokeList(stubAdmin(await seedAllStates()), { query: "p-" });
    expect(response.status).toBe(200);
    const body = response.body as { items: readonly { slug: string }[] };
    expect(body.items.map((item) => item.slug)).toEqual(["p-published"]);
  });

  it("by slug: published and unlisted open (200); draft and archived are 404 like a missing slug", async () => {
    const admin = stubAdmin(await seedAllStates());
    const open = async (slug: string) => invoke(admin, "/public/products/:slug", { slug });
    expect((await open("p-published")).status).toBe(200);
    expect((await open("p-unlisted")).status).toBe(200);

    const missing = await open("no-such-product");
    expect(missing.status).toBe(404);
    for (const slug of ["p-draft", "p-archived"]) {
      const hidden = await open(slug);
      expect(hidden.status).toBe(404);
      expect(JSON.stringify(hidden.body)).toBe(JSON.stringify(missing.body));
    }
  });

  it("SECURITY: the public DTO has description/type/tags/compare-at but never cost, barcode or weight", async () => {
    const catalog = catalogFixture();
    const created = unwrap<{ id: string }>(
      await catalog.products.create({
        sku: "SEC-1",
        name: "Secret margin",
        slug: "secret-margin",
        description: "Soft cotton.",
        productType: "Shirts",
        tags: ["summer"],
        variants: [
          {
            sku: "SEC-1-V",
            priceAmountMinor: 1000,
            currency: "USD",
            compareAtAmountMinor: 1500,
            costAmountMinor: 400,
            barcode: "6221234567890",
            weightGrams: 250,
            requiresShipping: false,
            taxable: false,
          },
        ],
        tenantId,
      }),
      "create product",
    );
    unwrap(await catalog.products.publish({ productId: created.id, tenantId }), "publish");

    const response = await invoke(stubAdmin(catalog), "/public/products/:slug", {
      slug: "secret-margin",
    });
    expect(response.status).toBe(200);
    const product = response.body as Record<string, unknown> & {
      variants: readonly Record<string, unknown>[];
    };
    expect(product.description).toBe("Soft cotton.");
    expect(product.productType).toBe("Shirts");
    expect(product.tags).toEqual(["summer"]);
    expect(product.variants[0]?.compareAtAmountMinor).toBe(1500);

    const forbidden = [
      "cost",
      "costAmountMinor",
      "barcode",
      "weightGrams",
      "requiresShipping",
      "taxable",
    ];
    for (const key of forbidden) {
      expect(Object.keys(product), `product leaks "${key}"`).not.toContain(key);
      expect(Object.keys(product.variants[0] ?? {}), `variant leaks "${key}"`).not.toContain(key);
    }
    // Nor smuggled in under another key.
    const wire = JSON.stringify(response.body);
    expect(wire).not.toContain("6221234567890");
    expect(wire).not.toContain('"cost');
  });
});

describe("public stock per variant (Plan 2B-1)", () => {
  const tenantId = "tenant-local";
  function inventoryFixture() {
    let n = 0;
    const idGenerator: IdGenerator = { generate: () => `inv-id-${(n += 1)}` };
    return wireInventory({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
  }

  it("GET /public/inventory rows carry the variant they belong to", async () => {
    const inventory = inventoryFixture();
    for (const [variantId, quantity] of [
      ["v-m", 5],
      ["v-l", 2],
    ] as const) {
      unwrap(
        await inventory.inventory.receive({
          tenantId,
          productId: "p1",
          variantId,
          warehouseId: "wh-1",
          quantity,
        }),
        "receive",
      );
    }
    unwrap(
      await inventory.inventory.receive({
        tenantId,
        productId: "p2",
        warehouseId: "wh-1",
        quantity: 3,
      }),
      "receive legacy",
    );
    const admin = {
      publicReads: { inventory: inventory.inventory },
    } as unknown as WiredAdmin;

    const response = await invoke(admin, "/public/inventory");

    const rows = (response.body as { items: { productId: string; variantId: string | null }[] })
      .items;
    expect(
      rows
        .filter((row) => row.productId === "p1")
        .map((row) => row.variantId)
        .sort(),
    ).toEqual(["v-l", "v-m"]);
    expect(rows.find((row) => row.productId === "p2")?.variantId).toBeNull();
  });

  it("the public variant says whether it sells past zero, and never exposes the raw switches", async () => {
    const catalog = catalogFixture();
    const created = unwrap<{ id: string }>(
      await catalog.products.create({
        sku: "SW-1",
        name: "Switches",
        slug: "switches",
        variants: [
          { sku: "SW-1-A", priceAmountMinor: 1000, currency: "USD" },
          { sku: "SW-1-B", priceAmountMinor: 1000, currency: "USD", tracksInventory: false },
          { sku: "SW-1-C", priceAmountMinor: 1000, currency: "USD", inventoryPolicy: "continue" },
        ],
        tenantId,
      }),
      "create product",
    );
    unwrap(await catalog.products.publish({ productId: created.id, tenantId }), "publish");

    const response = await invoke(stubAdmin(catalog), "/public/products/:slug", {
      slug: "switches",
    });

    const variants = (response.body as { variants: Record<string, unknown>[] }).variants;
    expect(variants.map((variant) => variant["sellableWhenOutOfStock"])).toEqual([
      false,
      true,
      true,
    ]);
    for (const variant of variants) {
      expect(Object.keys(variant)).not.toContain("tracksInventory");
      expect(Object.keys(variant)).not.toContain("inventoryPolicy");
    }
  });
});
