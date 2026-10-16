import {
  getCollectionBySlug,
  getCollectionProducts,
  getCollections,
  getInventory,
  getProductBySlug,
  getProducts,
  searchProducts,
  type CollectionSummary,
  type CursorPageInfo,
  type ProductSummary,
  type ProductVariantSummary,
} from "./runtime-api";

/** The collection page's own per-page size (T5.20) — a real page, not an attempt to fit everything on one request. */
export const COLLECTION_PRODUCTS_PAGE_SIZE = 24;

/**
 * Storefront-facing catalog resolution. Every public list route in `runtime-api.ts` returns
 * every row regardless of publish state (`ListProducts`/`ListCollections`/`ListPrices` filter
 * only soft-deleted rows — confirmed by reading `services/catalog`/`services/pricing`'s
 * in-memory repositories) — so "published" is enforced here, once, rather than trusted from
 * the wire. No product/collection this module resolves as `"ok"` can be a draft, a scheduled
 * item, or an archived one (an unlisted product resolves only by slug — see `resolveProductBySlug`).
 */

export type PublishedProduct = Omit<ProductSummary, "status"> & { readonly status: "published" };
/** Plan 2C-1: a product a shopper may open by its link and buy — published, or unlisted (never listed). */
export type SellableProduct = Omit<ProductSummary, "status"> & {
  readonly status: "published" | "unlisted";
};
export type PublishedCollection = Omit<CollectionSummary, "status"> & {
  readonly status: "published";
};

function isPublishedProduct(product: ProductSummary): product is PublishedProduct {
  return product.status === "published";
}

function isSellableProduct(product: ProductSummary): product is SellableProduct {
  return product.status === "published" || product.status === "unlisted";
}

function isPublishedCollection(collection: CollectionSummary): collection is PublishedCollection {
  return collection.status === "published";
}

export type ProductLookupResult =
  | { readonly status: "ok"; readonly product: SellableProduct }
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

/**
 * Resolves one product by slug via the public by-slug route. A published OR unlisted product
 * resolves (unlisted = reachable by its link, Plan 2C-1); anything else resolves to `"not-found"`,
 * matching what a shopper should see: it isn't for sale. Lists and search keep `isPublishedProduct`,
 * so an unlisted product never appears there.
 */
export async function resolveProductBySlug(slug: string): Promise<ProductLookupResult> {
  const product = await getProductBySlug(slug);
  if (product === null) return { status: "not-found" };
  if (!isSellableProduct(product)) return { status: "not-found" };
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
  | {
      readonly status: "ok";
      readonly amountMinor: number;
      readonly currency: string;
      /** The struck-through "was" price of the lowest-priced variant; null when it has none. */
      readonly compareAtMinor: number | null;
      /** True when the variants are not all priced alike, so the display reads "From …". */
      readonly varies: boolean;
    }
  | { readonly status: "unavailable" }
  /** Variants in two currencies — the backend forbids this since Plan 2C-1, so it is a data fault. */
  | { readonly status: "ambiguous" };

/**
 * Plan 2C-1 (closes G-94, storefront half): the displayed price comes from the product's own
 * variants — the same source the cart charges — never from the Pricing screen. Several prices show
 * the lowest as "from"; compare-at is shown only when it belongs to that lowest-priced variant.
 */
export function priceOf(product: Pick<ProductSummary, "variants">): PriceResolution {
  const [first] = product.variants;
  if (first === undefined) return { status: "unavailable" };
  if (product.variants.some((v: ProductVariantSummary) => v.currency !== first.currency)) {
    return { status: "ambiguous" };
  }
  const lowest = product.variants.reduce((min: ProductVariantSummary, v: ProductVariantSummary) =>
    v.priceAmountMinor < min.priceAmountMinor ? v : min,
  );
  return {
    status: "ok",
    amountMinor: lowest.priceAmountMinor,
    currency: lowest.currency,
    compareAtMinor: lowest.compareAtAmountMinor,
    varies: product.variants.some(
      (v: ProductVariantSummary) => v.priceAmountMinor !== lowest.priceAmountMinor,
    ),
  };
}

export type AvailabilityResolution =
  { readonly status: "ok"; readonly available: number } | { readonly status: "unknown" };

/** One stock row as the public inventory route returns it (Plan 2B-1 added `variantId`). */
interface AvailabilityRow {
  readonly productId: string;
  readonly variantId: string | null;
  readonly available: number;
}

/**
 * A lookup table of every product's availability (summed across warehouses), per variant since
 * Plan 2B-1. Rows are summed across warehouses, so the legacy-row rule below is applied per
 * product, not per warehouse (the backend's `resolveStockRow` applies it per warehouse).
 */
export class AvailabilityBook {
  private readonly byProduct = new Map<string, AvailabilityRow[]>();

  private constructor(items: readonly AvailabilityRow[]) {
    for (const item of items) {
      const rows = this.byProduct.get(item.productId);
      if (rows === undefined) this.byProduct.set(item.productId, [item]);
      else rows.push(item);
    }
  }

  static async load(): Promise<AvailabilityBook | null> {
    const items = await getInventory();
    if (items === null) return null;
    return new AvailabilityBook(items);
  }

  /**
   * Plan 2B-1: one variant's availability (same legacy rule as the backend's `resolveStockRow`):
   * the variant's own rows; else the product's variant-less rows, but only when ALL of the
   * product's rows are variant-less; else zero. Without a `variantId`, the product's total.
   */
  resolve(productId: string, variantId?: string): AvailabilityResolution {
    const rows = this.byProduct.get(productId) ?? [];
    if (rows.length === 0) return { status: "unknown" };
    const sum = (list: readonly AvailabilityRow[]) =>
      list.reduce((total, row) => total + row.available, 0);
    if (variantId === undefined) return { status: "ok", available: sum(rows) };
    const exact = rows.filter((row) => row.variantId === variantId);
    if (exact.length > 0) return { status: "ok", available: sum(exact) };
    const legacyOnly = rows.every((row) => row.variantId === null);
    return { status: "ok", available: legacyOnly ? sum(rows) : 0 };
  }

  /** The product as a whole: unlimited if any variant sells past zero; else the sum of its variants. */
  resolveProduct(product: Pick<ProductSummary, "id" | "variants">): AvailabilityResolution {
    if (product.variants.some((variant) => variant.sellableWhenOutOfStock)) {
      return { status: "ok", available: Number.POSITIVE_INFINITY };
    }
    return this.resolve(product.id);
  }
}
