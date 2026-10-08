import { describe, expect, it, vi } from "vitest";
import type {
  CollectionSummary,
  CursorPageResult,
  InventoryItemSummary,
  ProductSummary,
  ProductVariantSummary,
} from "./runtime-api";

const getProducts = vi.fn<() => Promise<readonly ProductSummary[] | null>>();
const getProductBySlug = vi.fn<(slug: string) => Promise<ProductSummary | null>>();
const getCollections = vi.fn<() => Promise<readonly CollectionSummary[] | null>>();
const getCollectionBySlug = vi.fn<(slug: string) => Promise<CollectionSummary | null>>();
const getCollectionProducts =
  vi.fn<
    (
      slug: string,
      first?: number,
      after?: string,
    ) => Promise<CursorPageResult<ProductSummary> | null>
  >();
const getInventory = vi.fn<() => Promise<readonly InventoryItemSummary[] | null>>();
const searchProducts = vi.fn<(query: string) => Promise<readonly ProductSummary[] | null>>();

vi.mock("./runtime-api", () => ({
  getProducts: () => getProducts(),
  getProductBySlug: (slug: string) => getProductBySlug(slug),
  getCollections: () => getCollections(),
  getCollectionBySlug: (slug: string) => getCollectionBySlug(slug),
  getCollectionProducts: (slug: string, first?: number, after?: string) =>
    getCollectionProducts(slug, first, after),
  getInventory: () => getInventory(),
  searchProducts: (query: string) => searchProducts(query),
}));

const {
  listPublishedProducts,
  listPublishedCollections,
  resolveProductBySlug,
  resolveCollectionBySlug,
  searchPublishedProducts,
  priceOf,
  AvailabilityBook,
} = await import("./catalog");

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "prod-1",
    sku: "SKU-1",
    name: "Wooden Blocks",
    slug: "wooden-blocks",
    status: "published",
    description: null,
    productType: null,
    tags: [],
    options: [],
    variants: [],
    ...overrides,
  };
}

function variant(overrides: Partial<ProductVariantSummary> = {}): ProductVariantSummary {
  return {
    id: "var-1",
    sku: "SKU-1-STD",
    priceAmountMinor: 1999,
    currency: "USD",
    selection: null,
    title: null,
    compareAtAmountMinor: null,
    ...overrides,
  };
}

function collection(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: "coll-1",
    name: "Featured Toys",
    slug: "featured-toys",
    status: "published",
    productIds: [],
    ...overrides,
  };
}

describe("listPublishedProducts", () => {
  it("keeps only published products", async () => {
    getProducts.mockResolvedValue([
      product({ id: "a", status: "published" }),
      product({ id: "b", status: "draft" }),
      product({ id: "c", status: "archived" }),
      product({ id: "d", status: "scheduled" }),
    ]);
    const result = await listPublishedProducts();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.products.map((p: ProductSummary) => p.id)).toEqual(["a"]);
  });

  it("surfaces an error without falling back to demo data", async () => {
    getProducts.mockResolvedValue(null);
    expect(await listPublishedProducts()).toEqual({ status: "error" });
  });
});

describe("searchPublishedProducts", () => {
  it("keeps only published products among the search matches", async () => {
    searchProducts.mockResolvedValue([
      product({ id: "a", status: "published" }),
      product({ id: "b", status: "draft" }),
    ]);
    const result = await searchPublishedProducts("wooden");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.products.map((p: ProductSummary) => p.id)).toEqual(["a"]);
    expect(searchProducts).toHaveBeenCalledWith("wooden");
  });

  it("surfaces an error without falling back to demo data", async () => {
    searchProducts.mockResolvedValue(null);
    expect(await searchPublishedProducts("wooden")).toEqual({ status: "error" });
  });
});

describe("resolveProductBySlug", () => {
  it("resolves a published product by slug", async () => {
    getProductBySlug.mockResolvedValue(product({ slug: "wooden-blocks", status: "published" }));
    const result = await resolveProductBySlug("wooden-blocks");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.product.slug).toBe("wooden-blocks");
  });

  it("resolves an unlisted product by slug — reachable by its link (Plan 2C-1)", async () => {
    getProductBySlug.mockResolvedValue(product({ slug: "wooden-blocks", status: "unlisted" }));
    const result = await resolveProductBySlug("wooden-blocks");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.product.status).toBe("unlisted");
  });

  it("treats an unpublished product as not-found — a shopper should not see a draft", async () => {
    getProductBySlug.mockResolvedValue(product({ slug: "wooden-blocks", status: "draft" }));
    expect(await resolveProductBySlug("wooden-blocks")).toEqual({ status: "not-found" });
  });

  it("returns not-found for a slug that doesn't exist", async () => {
    getProductBySlug.mockResolvedValue(null);
    expect(await resolveProductBySlug("wooden-blocks")).toEqual({ status: "not-found" });
  });
});

describe("resolveCollectionBySlug", () => {
  it("resolves a published collection and its published member products for one page", async () => {
    getCollectionBySlug.mockResolvedValue(
      collection({ slug: "featured", productIds: ["a", "b", "c"] }),
    );
    getCollectionProducts.mockResolvedValue({
      items: [
        product({ id: "a", status: "published" }),
        product({ id: "b", status: "draft" }),
        // "c" no longer resolves (stale/deleted) — the route already dropped it server-side.
      ],
      pageInfo: { hasNextPage: false, endCursor: "1" },
    });
    const result = await resolveCollectionBySlug("featured");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.products.map((p: ProductSummary) => p.id)).toEqual(["a"]);
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: "1" });
  });

  it("forwards the page size and an `after` cursor to the paginated route", async () => {
    getCollectionBySlug.mockResolvedValue(collection({ slug: "featured" }));
    getCollectionProducts.mockResolvedValue({
      items: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    await resolveCollectionBySlug("featured", "5");
    expect(getCollectionProducts).toHaveBeenCalledWith("featured", 24, "5");
  });

  it("treats an unpublished collection as not-found without calling the products route", async () => {
    getCollectionProducts.mockClear();
    getCollectionBySlug.mockResolvedValue(collection({ slug: "featured", status: "draft" }));
    expect(await resolveCollectionBySlug("featured")).toEqual({ status: "not-found" });
    expect(getCollectionProducts).not.toHaveBeenCalled();
  });

  it("returns not-found for a slug that doesn't exist, without calling the products route", async () => {
    getCollectionProducts.mockClear();
    getCollectionBySlug.mockResolvedValue(null);
    expect(await resolveCollectionBySlug("featured")).toEqual({ status: "not-found" });
    expect(getCollectionProducts).not.toHaveBeenCalled();
  });

  it("surfaces an error when the products page call fails", async () => {
    getCollectionBySlug.mockResolvedValue(collection({ slug: "featured" }));
    getCollectionProducts.mockResolvedValue(null);
    expect(await resolveCollectionBySlug("featured")).toEqual({ status: "error" });
  });
});

describe("priceOf (Plan 2C-1: the variant is the only price source)", () => {
  it("one variant: its price and compare-at", () => {
    expect(
      priceOf(
        product({ variants: [variant({ priceAmountMinor: 1999, compareAtAmountMinor: 2999 })] }),
      ),
    ).toEqual({
      status: "ok",
      amountMinor: 1999,
      currency: "USD",
      compareAtMinor: 2999,
      varies: false,
    });
  });

  it("several variants: the lowest price, flagged as varying", () => {
    const result = priceOf(
      product({
        variants: [
          variant({ id: "a", priceAmountMinor: 12000 }),
          variant({ id: "b", priceAmountMinor: 10000 }),
        ],
      }),
    );
    expect(result).toEqual({
      status: "ok",
      amountMinor: 10000,
      currency: "USD",
      compareAtMinor: null,
      varies: true,
    });
  });

  it("compare-at is the lowest-priced variant's own, never another variant's", () => {
    const result = priceOf(
      product({
        variants: [
          variant({ id: "a", priceAmountMinor: 12000, compareAtAmountMinor: 15000 }),
          variant({ id: "b", priceAmountMinor: 10000, compareAtAmountMinor: null }),
        ],
      }),
    );
    expect(result.status === "ok" && result.compareAtMinor).toBeNull();
  });

  it("several variants with one price: not varying", () => {
    const result = priceOf(product({ variants: [variant({ id: "a" }), variant({ id: "b" })] }));
    expect(result.status === "ok" && result.varies).toBe(false);
  });

  it("no variants: unavailable; two currencies: ambiguous", () => {
    expect(priceOf(product({ variants: [] }))).toEqual({ status: "unavailable" });
    expect(
      priceOf(product({ variants: [variant({ id: "a" }), variant({ id: "b", currency: "EGP" })] })),
    ).toEqual({ status: "ambiguous" });
  });
});

describe("AvailabilityBook", () => {
  it("sums availability across warehouses for the same product", async () => {
    getInventory.mockResolvedValue([
      { id: "i1", productId: "prod-1", warehouseId: "w1", onHand: 10, reserved: 2, available: 8 },
      { id: "i2", productId: "prod-1", warehouseId: "w2", onHand: 5, reserved: 0, available: 5 },
    ]);
    const book = await AvailabilityBook.load();
    expect(book?.resolve("prod-1")).toEqual({ status: "ok", available: 13 });
  });

  it("reports 'unknown' rather than zero for a product with no inventory row", async () => {
    getInventory.mockResolvedValue([]);
    const book = await AvailabilityBook.load();
    expect(book?.resolve("prod-1")).toEqual({ status: "unknown" });
  });

  it("returns null when the API call fails", async () => {
    getInventory.mockResolvedValue(null);
    expect(await AvailabilityBook.load()).toBeNull();
  });
});

describe("listPublishedCollections", () => {
  it("keeps only published collections", async () => {
    getCollections.mockResolvedValue([
      collection({ id: "a", status: "published" }),
      collection({ id: "b", status: "draft" }),
    ]);
    const result = await listPublishedCollections();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.collections.map((c: CollectionSummary) => c.id)).toEqual(["a"]);
  });
});
