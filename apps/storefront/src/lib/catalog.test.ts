import { describe, expect, it, vi } from "vitest";
import type {
  CollectionSummary,
  CursorPageResult,
  InventoryItemSummary,
  PriceSummary,
  ProductSummary,
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
const getPrices = vi.fn<() => Promise<readonly PriceSummary[] | null>>();
const getInventory = vi.fn<() => Promise<readonly InventoryItemSummary[] | null>>();
const searchProducts = vi.fn<(query: string) => Promise<readonly ProductSummary[] | null>>();

vi.mock("./runtime-api", () => ({
  getProducts: () => getProducts(),
  getProductBySlug: (slug: string) => getProductBySlug(slug),
  getCollections: () => getCollections(),
  getCollectionBySlug: (slug: string) => getCollectionBySlug(slug),
  getCollectionProducts: (slug: string, first?: number, after?: string) =>
    getCollectionProducts(slug, first, after),
  getPrices: () => getPrices(),
  getInventory: () => getInventory(),
  searchProducts: (query: string) => searchProducts(query),
}));

const {
  listPublishedProducts,
  listPublishedCollections,
  resolveProductBySlug,
  resolveCollectionBySlug,
  searchPublishedProducts,
  PriceBook,
  AvailabilityBook,
} = await import("./catalog");

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "prod-1",
    sku: "SKU-1",
    name: "Wooden Blocks",
    slug: "wooden-blocks",
    status: "published",
    variants: [],
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

function price(overrides: Partial<PriceSummary> = {}): PriceSummary {
  return {
    id: "price-1",
    productId: "prod-1",
    amountMinor: 1999,
    currency: "USD",
    status: "published",
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

describe("PriceBook", () => {
  it("resolves the one published price for a product", async () => {
    getPrices.mockResolvedValue([price({ productId: "prod-1", amountMinor: 1999 })]);
    const book = await PriceBook.load();
    expect(book?.resolve("prod-1")).toEqual({ status: "ok", amountMinor: 1999, currency: "USD" });
  });

  it("ignores draft prices — never shows a price that isn't published", async () => {
    getPrices.mockResolvedValue([price({ productId: "prod-1", status: "draft" })]);
    const book = await PriceBook.load();
    expect(book?.resolve("prod-1")).toEqual({ status: "unavailable" });
  });

  it("reports 'ambiguous' rather than guessing when two prices are published for one product (CPI-3)", async () => {
    getPrices.mockResolvedValue([
      price({ id: "p1", productId: "prod-1", amountMinor: 1999 }),
      price({ id: "p2", productId: "prod-1", amountMinor: 2499 }),
    ]);
    const book = await PriceBook.load();
    expect(book?.resolve("prod-1")).toEqual({ status: "ambiguous" });
  });

  it("reports 'unavailable' for a product with no price row at all", async () => {
    getPrices.mockResolvedValue([]);
    const book = await PriceBook.load();
    expect(book?.resolve("prod-1")).toEqual({ status: "unavailable" });
  });

  it("returns null when the API call fails, never a fabricated price", async () => {
    getPrices.mockResolvedValue(null);
    expect(await PriceBook.load()).toBeNull();
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
