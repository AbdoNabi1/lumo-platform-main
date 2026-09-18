import { z } from "zod";
import type { Category, Collection, Product } from "@platform/catalog";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { InventoryItem } from "@platform/inventory";
import type { Price } from "@platform/pricing";
import type { Paginated } from "@platform/types";
import type { WiredAdmin } from "../composition";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

/**
 * `GET /public/products` only — a substring `query` (T5.15, storefront search). Kept as its own
 * schema rather than widened onto the shared `pageQuery` above: `pageQuery` also backs categories/
 * collections/prices/inventory, none of which have a `query`-aware `list()` use case, so adding the
 * field there would silently accept and drop it for those routes instead of validating it.
 * `ListProductsInput` (`services/catalog/src/application/list-products.use-case.ts`) already
 * declares `query?: string` and `ListProducts.execute()` already delegates to a case-insensitive
 * substring search when it's present — this schema just lets the public route forward it.
 */
const publicProductsQuery = pageQuery.extend({
  query: z.string().min(1).optional(),
});

const slugParams = z.object({ slug: z.string().min(1) });

/**
 * The public, unauthenticated storefront read surface (Sprint 9 hardening) — products/categories/
 * collections/prices/inventory, mounted on the SAME Runtime Gateway HTTP server as every admin
 * route (not a parallel API), at `/public/*` paths, `public: true` so the pipeline skips
 * authentication and the permission guard (`packages/http/src/route.ts`) — the routes below
 * intentionally reuse `admin.publicReads`' unguarded controllers rather than the guarded
 * `*AdminController` wrappers, which would otherwise either silently allow everything
 * (`AllowAllAccessControl`) or silently deny everything (Keto, no policy for a fabricated anonymous
 * principal) depending on the deployment. Write routes are not present here and never will be —
 * this file is read-only by construction.
 *
 * ── Domain aggregates are never put on the wire (added when this surface was first exercised) ──
 * Every `list()` use case behind these routes returns `Paginated<TAggregate>` — real domain
 * entities, not DTOs. `Entity` holds `props`/`_id` as `protected`, which is a compile-time
 * modifier only: at runtime they are ordinary own enumerable properties, so Fastify's
 * `JSON.stringify` emitted the aggregate's internals verbatim. Verified against `Collection`:
 *
 *   {"items":[{"props":{"name":"Featured Toys","slug":{"props":{"value":"featured-toys"}},
 *     "status":"draft","productIds":[],"deleted":false},"_id":{"props":"01J..."},
 *     "_domainEvents":{"events":[{"eventId":"evt-1","eventName":"collection.created",...}]},
 *     "_version":0}]}
 *
 * That leaked `_domainEvents` (the unpublished domain-event stream), `_version` (the optimistic
 * lock), and `deleted` to anonymous callers, and nested every field under `props` — so no consumer
 * could read `name`/`slug` at the documented path either. The mappers below are the boundary that
 * was missing: each route now projects its aggregate to an explicit, flat, public-safe DTO. Adding
 * a field here is a deliberate act; it can no longer happen by adding one to a domain aggregate.
 */

export interface PageResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Projects a controller's `Paginated<TAggregate>` body through `toDto`, leaving `pageInfo` and any
 * non-2xx error envelope untouched (an error body is not a page and must not be mapped). Exported
 * so any route that returns a `Paginated<TAggregate>` can flatten it to a DTO the same way, instead
 * of re-deriving this — `admin-routes.ts`'s `GET /orders` is the first authenticated (non-public)
 * consumer.
 */
export function mapPage<TAggregate, TDto>(
  response: PageResponse,
  toDto: (aggregate: TAggregate) => TDto,
): PageResponse {
  if (response.status < 200 || response.status >= 300) return response;
  const page = response.body as Paginated<TAggregate>;
  return {
    status: response.status,
    body: { items: page.items.map(toDto), pageInfo: page.pageInfo },
  };
}

/**
 * Every DTO below is declared with an explicit, fully-primitive interface rather than an inferred
 * or `unknown` return type. That is load-bearing: `Product.status` is a `PublishState` VALUE OBJECT
 * (not a string) and `Product.sku`/`slug` are `Sku`/`Slug` — an inferred mapper happily passes the
 * whole VO through and re-creates the nested-`props` leak one field at a time. With these types the
 * compiler rejects any field that is not already flattened to a primitive.
 */

export interface PublicVariantDto {
  readonly id: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
}

export interface PublicProductDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly variants: readonly PublicVariantDto[];
}

export interface PublicCategoryDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
}

export interface PublicCollectionDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly productIds: readonly string[];
}

export interface PublicPriceDto {
  readonly id: string;
  readonly productId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: string;
}

export interface PublicInventoryDto {
  readonly id: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

/** Public product projection — identity, naming, publish state, and purchasable variants only. */
function toProductDto(product: Product): PublicProductDto {
  return {
    id: product.id.value,
    sku: product.sku.value,
    name: product.name,
    slug: product.slug.value,
    status: product.status.value,
    variants: product.variants.map((variant) => ({
      id: variant.id.value,
      sku: variant.sku.value,
      priceAmountMinor: variant.price.amountMinor,
      currency: variant.price.currency,
    })),
  };
}

/** Public category projection — the storefront navigation tree's node shape. */
function toCategoryDto(category: Category): PublicCategoryDto {
  return {
    id: category.id.value,
    name: category.name,
    slug: category.slug.value,
    parentId: category.parentId,
  };
}

/** Public collection projection — curated membership order is part of the contract. */
function toCollectionDto(collection: Collection): PublicCollectionDto {
  return {
    id: collection.id.value,
    name: collection.name,
    slug: collection.slug.value,
    status: collection.status,
    productIds: [...collection.productIds],
  };
}

/**
 * Public price projection — `compareAt`/`cost`/`taxClassRef` are deliberately withheld: `cost` is
 * merchant-confidential margin data that anonymous callers must never receive.
 */
function toPriceDto(price: Price): PublicPriceDto {
  return {
    id: price.id.value,
    productId: price.product.value,
    amountMinor: price.amount.amountMinor,
    currency: price.amount.currency,
    status: price.status,
  };
}

/**
 * Public inventory projection — availability only; the live `reservations` set is withheld, as it
 * would expose other customers' in-flight carts.
 */
function toInventoryDto(item: InventoryItem): PublicInventoryDto {
  return {
    id: item.id.value,
    productId: item.product.value,
    warehouseId: item.warehouseId.value,
    onHand: item.stockLevel.onHand,
    reserved: item.stockLevel.reserved,
    available: item.stockLevel.available,
  };
}

/**
 * The public price surface must never serve unpublished prices. `ListPrices` deliberately does
 * not filter by status — the authenticated admin surface shares that use case and needs drafts.
 * So the boundary filters here instead. Note the consequence: `pageInfo` still describes the
 * unfiltered page, so a page can come back with fewer items than `first` while `hasNextPage`
 * is true. That is correct for a cursor API — the caller follows the cursor — but it means
 * callers must not treat "fewer than requested" as "end of list".
 */
function publishedOnly(response: PageResponse): PageResponse {
  if (response.status < 200 || response.status >= 300) return response;
  const page = response.body as { items: readonly PublicPriceDto[]; pageInfo: unknown };
  return {
    status: response.status,
    body: {
      items: page.items.filter((price) => price.status === "published"),
      pageInfo: page.pageInfo,
    },
  };
}

export function publicCatalogRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/products",
      version: 1,
      permission: "products:read",
      public: true,
      summary: "Public: list products (cursor pagination, optional substring `query` search)",
      schema: { querystring: publicProductsQuery },
      // ADR-0014: ListProductsInput now requires tenantId, from the already-verified
      // context.tenantId (packages/http's tenant-resolution chain) — this route is `public: true`
      // (no principal/authorization required) but still runs behind tenant resolution, per
      // packages/http/src/server.ts's "nothing below runs tenant-less, public routes included".
      handle: async ({ query, context }) =>
        mapPage(
          await admin.publicReads.products.list({ ...query, tenantId: context.tenantId }),
          toProductDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/public/products/:slug",
      version: 1,
      permission: "products:read",
      public: true,
      summary: "Public: get one product by slug",
      schema: { params: slugParams },
      handle: async ({ params, context }) => {
        const response = await admin.publicReads.products.getBySlug({
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toProductDto(response.body as Product) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/categories",
      version: 1,
      permission: "categories:read",
      public: true,
      summary: "Public: list categories (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.publicReads.categories.list({ ...query, tenantId: context.tenantId }),
          toCategoryDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/public/collections",
      version: 1,
      permission: "collections:read",
      public: true,
      summary: "Public: list collections (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.publicReads.collections.list({ ...query, tenantId: context.tenantId }),
          toCollectionDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/public/collections/:slug",
      version: 1,
      permission: "collections:read",
      public: true,
      summary: "Public: get one collection by slug",
      schema: { params: slugParams },
      handle: async ({ params, context }) => {
        const response = await admin.publicReads.collections.getBySlug({
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toCollectionDto(response.body as Collection) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/collections/:slug/products",
      version: 1,
      permission: "collections:read",
      public: true,
      summary:
        "Public: list a collection's published member products, in curated order (cursor pagination)",
      schema: { params: slugParams, querystring: pageQuery },
      handle: async ({ params, query, context }) =>
        mapPage(
          await admin.publicReads.collections.listMemberProducts({
            ...params,
            ...query,
            tenantId: context.tenantId,
          }),
          toProductDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/public/prices",
      version: 1,
      permission: "pricing:read",
      public: true,
      summary: "Public: list published prices (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        publishedOnly(
          mapPage(
            await admin.publicReads.prices.list({ ...query, tenantId: context.tenantId }),
            toPriceDto,
          ),
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/public/inventory",
      version: 1,
      permission: "inventory:read",
      public: true,
      summary: "Public: list inventory availability (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query }) =>
        mapPage(await admin.publicReads.inventory.list(query), toInventoryDto),
    }),
  ] as readonly RouteDefinition[];
}
