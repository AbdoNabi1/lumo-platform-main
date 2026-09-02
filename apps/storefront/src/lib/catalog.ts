import {
  getCollectionBySlug,
  getCollectionProducts,
  getCollections,
  getInventory,
  getPrices,
  getProductBySlug,
  getProducts,
  searchProducts,
  type CollectionSummary,
  type CursorPageInfo,
  type PriceSummary,
  type ProductSummary,
} from "./runtime-api";

/** The collection page's own per-page size (T5.20) — a real page, not an attempt to fit everything on one request. */
export const COLLECTION_PRODUCTS_PAGE_SIZE = 24;

/**
 * Storefront-facing catalog resolution. Every public list route in `runtime-api.ts` returns
 * every row regardless of publish state (`ListProducts`/`ListCollections`/`ListPrices` filter
 * only soft-deleted rows — confirmed by reading `services/catalog`/`services/pricing`'s
 * in-memory repositories) — so "published" is enforced here, once, rather than trusted from
 * the wire. No product/collection this module resolves as `"ok"` can be a draft, a scheduled
 * item, or an archived one.
 */

export type PublishedProduct = Omit<ProductSummary, "status"> & { readonly status: "published" };
export type PublishedCollection = Omit<CollectionSummary, "status"> & {
  readonly status: "published";
};

function isPublishedProduct(product: ProductSummary): product is PublishedProduct {
  return product.status === "published";
}

function isPublishedCollection(collection: CollectionSummary): collection is PublishedCollection {
  return collection.status === "published";
}

export type ProductLookupResult =
  | { readonly status: "ok"; readonly product: PublishedProduct }
  | { readonly status: "not-found" }
  | { readonly status: "error" };

export type ProductListResult =
  | { readonly status: "ok"; readonly products: readonly PublishedProduct[] }
  | { readonly status: "error" };

export type CollectionLookupResult =
  | {
      readonly status: "ok";
      readonly collection: PublishedCollection;
      readonly products: readonly PublishedProduct[];
      /** Whether more member products exist beyond this page, and the cursor to fetch them (T5.20). */
      readonly pageInfo: CursorPageInfo;
    }
  | { readonly status: "not-found" }
  | { readonly status: "error" };

/** Every published product, degrading to `"error"` only when the API call itself failed. */
export async function listPublishedProducts(): Promise<ProductListResult> {
  const products = await getProducts();
  if (products === null) return { status: "error" };
  return { status: "ok", products: products.filter(isPublishedProduct) };
}

/**
 * Published products matching a substring search `query` (T5.15). Same "published" trust
 * boundary as `listPublishedProducts` — `searchProducts` hits the same `GET /public/products`
 * route and returns every status, so a draft/scheduled/archived product must never leak into
 * search results just because its name matched.
 */
export async function searchPublishedProducts(query: string): Promise<ProductListResult> {
  const products = await searchProducts(query);
  if (products === null) return { status: "error" };
  return { status: "ok", products: products.filter(isPublishedProduct) };
}

/** Every published collection. */
export async function listPublishedCollections(): Promise<
  | { readonly status: "ok"; readonly collections: readonly PublishedCollection[] }
  | { readonly status: "error" }
> {
  const collections = await getCollections();
  if (collections === null) return { status: "error" };
  return { status: "ok", collections: collections.filter(isPublishedCollection) };
}

/** Resolves one product by slug via the public by-slug route. A product that exists but isn't published resolves to `"not-found"`, matching what a shopper should see: it isn't for sale yet. */
export async function resolveProductBySlug(slug: string): Promise<ProductLookupResult> {
  const product = await getProductBySlug(slug);
  if (product === null) return { status: "not-found" };
  if (!isPublishedProduct(product)) return { status: "not-found" };
  return { status: "ok", product };
}

/**
 * Resolves one collection by slug via the public by-slug route, plus ONE page of its published
 * member products in curated order, via the dedicated paginated route
 * (`GET /public/collections/:slug/products`, T5.20). `after` forwards the caller's cursor
 * (`result.pageInfo.endCursor` from a previous call) to fetch the next page.
 *
 * Replaces the former approach of fetching the collection plus the whole catalog's first 100
 * products and intersecting client-side, which silently dropped any member beyond that first
 * page. The collection lookup runs first (not in parallel with the products page): the products
 * route itself 404s for a missing/unpublished collection, so probing it before knowing the
 * collection's own status would conflate "collection genuinely not found" with "the Runtime API
 * call failed" — both currently surface as `null` from the fetch helpers.
 */
export async function resolveCollectionBySlug(
  slug: string,
  after?: string,
): Promise<CollectionLookupResult> {
  const collection = await getCollectionBySlug(slug);
  if (collection === null || !isPublishedCollection(collection)) return { status: "not-found" };

  const page = await getCollectionProducts(slug, COLLECTION_PRODUCTS_PAGE_SIZE, after);
  if (page === null) return { status: "error" };

  const products = page.items.filter(isPublishedProduct);
  return { status: "ok", collection, products, pageInfo: page.pageInfo };
}

export type PriceResolution =
  | { readonly status: "ok"; readonly amountMinor: number; readonly currency: string }
  | { readonly status: "unavailable" }
  /**
   * More than one row is `"published"` for the same product — a real backend gap (Pricing has
   * no invariant preventing concurrently-published prices; `CPI-3` in
   * `docs/ui/PLATFORM_FEATURE_INVENTORY.md`). Picking one silently would risk showing a wrong
   * amount to a shopper, so this is surfaced as its own state instead of guessed at.
   */
  | { readonly status: "ambiguous" };

/** A lookup table of every product's resolved published price, built from one `getPrices()` call. */
export class PriceBook {
  private readonly byProduct = new Map<string, PriceSummary[]>();

  private constructor(prices: readonly PriceSummary[]) {
    for (const price of prices) {
      if (price.status !== "published") continue;
      const bucket = this.byProduct.get(price.productId);
      if (bucket === undefined) {
        this.byProduct.set(price.productId, [price]);
      } else {
        bucket.push(price);
      }
    }
  }

  static async load(): Promise<PriceBook | null> {
    const prices = await getPrices();
    if (prices === null) return null;
    return new PriceBook(prices);
  }

  resolve(productId: string): PriceResolution {
    const bucket = this.byProduct.get(productId);
    if (bucket === undefined || bucket.length === 0) return { status: "unavailable" };
    if (bucket.length > 1) return { status: "ambiguous" };
    const [price] = bucket;
    if (price === undefined) return { status: "unavailable" };
    return { status: "ok", amountMinor: price.amountMinor, currency: price.currency };
  }
}

export type AvailabilityResolution =
  { readonly status: "ok"; readonly available: number } | { readonly status: "unknown" };

/** A lookup table of every product's total availability (summed across warehouses). */
export class AvailabilityBook {
  private readonly byProduct = new Map<string, number>();

  private constructor(
    items: readonly { readonly productId: string; readonly available: number }[],
  ) {
    for (const item of items) {
      this.byProduct.set(
        item.productId,
        (this.byProduct.get(item.productId) ?? 0) + item.available,
      );
    }
  }

  static async load(): Promise<AvailabilityBook | null> {
    const items = await getInventory();
    if (items === null) return null;
    return new AvailabilityBook(items);
  }

  resolve(productId: string): AvailabilityResolution {
    const available = this.byProduct.get(productId);
    if (available === undefined) return { status: "unknown" };
    return { status: "ok", available };
  }
}
