import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface ProductListItemDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly variantCount: number;
  readonly priceAmountMinor: number | null;
  readonly currency: string | null;
}

export interface ProductsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface ProductsPageDto {
  readonly items: readonly ProductListItemDto[];
  readonly pageInfo: ProductsPageInfo;
}

function isProductsPageDto(value: unknown): value is ProductsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export interface ProductsListQuery {
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export type FetchProductsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly ProductListItemDto[];
      readonly pageInfo: ProductsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a filtered, cursor-paginated page of products for the Products list screen. */
export async function fetchProductsPage(
  query: ProductsListQuery,
): Promise<FetchProductsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.query !== undefined) params.set("query", query.query);

  const result = await getAdminApi(`/api/v1/products?${params.toString()}`, isProductsPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export interface ProductVariantDto {
  readonly id: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
  readonly selection: Readonly<Record<string, string>> | null;
}

export interface ProductOptionDto {
  readonly name: string;
  readonly values: readonly string[];
}

export interface ProductDetailDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly scheduledAt: string | null;
  readonly brandId: string | null;
  readonly categoryIds: readonly string[];
  readonly options: readonly ProductOptionDto[];
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly variants: readonly ProductVariantDto[];
  readonly mediaAssetIds: readonly string[];
}

function isProductDetailDto(value: unknown): value is ProductDetailDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { variants?: unknown }).variants)
  );
}

export type FetchProductResult =
  | { readonly outcome: "ok"; readonly product: ProductDetailDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single product for the Product Detail screen. */
export async function fetchProduct(productId: string): Promise<FetchProductResult> {
  const result = await getAdminApi(
    `/api/v1/products/${encodeURIComponent(productId)}`,
    isProductDetailDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", product: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

export interface ProductInventoryRowDto {
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

function isProductInventoryRows(value: unknown): value is readonly ProductInventoryRowDto[] {
  return Array.isArray(value);
}

export type FetchProductInventoryResult =
  | { readonly outcome: "ok"; readonly rows: readonly ProductInventoryRowDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

export interface CreateProductVariantInput {
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
}

export interface CreateProductInput {
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly variants: readonly CreateProductVariantInput[];
}

/**
 * `POST /products` returns the created `Product` **aggregate**, not a DTO (see `admin-routes.ts`'s
 * own route — it returns `admin.products.createProduct(...)` directly). We never type the whole
 * aggregate here: this only validates that the response is an object and reads an `id` off it
 * (either a plain top-level `id`, matching a DTO shape, or nothing — an id we cannot read is a
 * redirect problem for the caller, not a failure to report to the operator).
 */
function isCreatedProduct(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

/** Creates a product with at least one variant (`POST /products`, `idempotent: true`). */
export async function createProduct(
  input: CreateProductInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/products",
    { method: "POST", body: input, idempotencyKey },
    isCreatedProduct,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

/** Updates a product's name/slug (`POST /products/:productId`, `idempotent: true`). */
export function updateProduct(
  productId: string,
  input: { readonly name: string; readonly slug: string },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/products/${encodeURIComponent(productId)}`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** Fetches a product's stock across every warehouse for the Product Detail screen. */
export async function fetchProductInventory(
  productId: string,
): Promise<FetchProductInventoryResult> {
  const result = await getAdminApi(
    `/api/v1/products/${encodeURIComponent(productId)}/inventory`,
    isProductInventoryRows,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", rows: result.data };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

/**
 * T5.1 — the 15 product write routes below (`admin-routes.ts` lines ~707-938) all follow
 * `updateProduct`'s lead: none of their handlers map the response through a DTO (several return
 * the `Product` aggregate directly), so every one of these reads nothing off the response body —
 * `isUnknown` only checks the call succeeded. Callers `revalidatePath` the detail page afterwards,
 * which re-fetches the real, DTO-mapped state via `fetchProduct`. This is deliberate, not an
 * oversight: typing fields off an unmapped aggregate response would risk encoding the same
 * `props`/`_id` leak `docs/plans/BLOCKERS.md`'s T0.6 entry found and fixed for Analytics.
 */

function path(productId: string, suffix = ""): string {
  return `/api/v1/products/${encodeURIComponent(productId)}${suffix}`;
}

/** `POST /products/:productId/publish` (`idempotent: true`, `products:publish`). */
export function publishProduct(
  productId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(path(productId, "/publish"), { method: "POST", idempotencyKey }, isUnknown);
}

/** `POST /products/:productId/schedule-publish` (`idempotent: true`, `products:publish`). */
export function schedulePublishProduct(
  productId: string,
  input: { readonly scheduledAt: string },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/schedule-publish"),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/unpublish` (`idempotent: true`, `products:publish`). */
export function unpublishProduct(
  productId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/unpublish"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/archive` (`idempotent: true`, `products:update`). */
export function archiveProduct(
  productId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(path(productId, "/archive"), { method: "POST", idempotencyKey }, isUnknown);
}

/** `POST /products/:productId/delete` (`idempotent: true`, `products:delete`) — soft-delete. */
export function deleteProduct(
  productId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(path(productId, "/delete"), { method: "POST", idempotencyKey }, isUnknown);
}

export interface AddProductVariantInput {
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
  readonly selection?: Readonly<Record<string, string>>;
}

/** `POST /products/:productId/variants` (`idempotent: true`, `products:update`) — add a variant. */
export function addProductVariant(
  productId: string,
  input: AddProductVariantInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/variants"),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/variants/:variantId/remove` (`idempotent: true`, `products:update`). */
export function removeProductVariant(
  productId: string,
  variantId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, `/variants/${encodeURIComponent(variantId)}/remove`),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/variants/:variantId` (`idempotent: true`, `products:update`) — edit sku/price. */
export function updateProductVariant(
  productId: string,
  variantId: string,
  input: CreateProductVariantInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, `/variants/${encodeURIComponent(variantId)}`),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** One row of the declared option matrix, as sent to `setProductOptions` (full replace). */
export interface ProductOptionInput {
  readonly name: string;
  readonly values: readonly string[];
}

/**
 * `POST /products/:productId/options` (`idempotent: true`, `products:update`) — replaces the
 * whole declared option set. Draft-only on the backend; a published product's rejection surfaces
 * as a normal `MutationResult` error via `toFormState`, not pre-blocked here.
 */
export function setProductOptions(
  productId: string,
  options: readonly ProductOptionInput[],
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/options"),
    { method: "POST", body: { options }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/seo` (`idempotent: true`, `products:update`). */
export function setProductSeo(
  productId: string,
  input: { readonly title?: string; readonly description?: string },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/seo"),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/brand` (`idempotent: true`, `products:update`) — assign or clear. */
export function setProductBrand(
  productId: string,
  brandId: string | null,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/brand"),
    { method: "POST", body: { brandId }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/categories` (`idempotent: true`, `products:update`) — full replace. */
export function assignProductCategories(
  productId: string,
  categoryIds: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/categories"),
    { method: "POST", body: { categoryIds }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /products/:productId/media` (`idempotent: true`, `products:update`) — attach one asset. */
export function attachProductMedia(
  productId: string,
  assetId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/media"),
    { method: "POST", body: { assetId }, idempotencyKey },
    isUnknown,
  );
}

/** `DELETE /products/:productId/media/:assetId` (`idempotent: true`, `products:update`). */
export function detachProductMedia(
  productId: string,
  assetId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, `/media/${encodeURIComponent(assetId)}`),
    { method: "DELETE", idempotencyKey },
    isUnknown,
  );
}

/** `PUT /products/:productId/media` (`idempotent: true`, `products:update`) — full reorder. */
export function reorderProductMedia(
  productId: string,
  assetIds: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    path(productId, "/media"),
    { method: "PUT", body: { assetIds }, idempotencyKey },
    isUnknown,
  );
}
