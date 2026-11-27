import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/** `AdminCollectionDto` of `apps/admin/src/http/collections-routes.ts`. */
export interface CollectionDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "draft" | "published";
  readonly productIds: readonly string[];
  readonly productCount: number;
}

/** `AdminCollectionMemberDto` of `apps/admin/src/interfaces/collections.admin-controller.ts`. */
export interface CollectionMemberDto {
  readonly productId: string;
  /** Index in the collection's full, ordered `productIds`. */
  readonly position: number;
  readonly name: string | null;
  readonly status: "draft" | "scheduled" | "published" | "unlisted" | "archived" | null;
  /** The product id no longer resolves (deleted); the merchant can still remove it. */
  readonly missing: boolean;
}

export interface CollectionsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface PageDto<T> {
  readonly items: readonly T[];
  readonly pageInfo: CollectionsPageInfo;
}

function isPageDto<T>(value: unknown): value is PageDto<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { pageInfo?: unknown }).pageInfo === "object" &&
    (value as { pageInfo?: unknown }).pageInfo !== null
  );
}

function isCollectionDto(value: unknown): value is CollectionDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Record<keyof CollectionDto, unknown>>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.slug === "string" &&
    (v.status === "draft" || v.status === "published") &&
    Array.isArray(v.productIds) &&
    typeof v.productCount === "number"
  );
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreated(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export interface CollectionsListQuery {
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export type FetchCollectionsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly CollectionDto[];
      readonly pageInfo: CollectionsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /collections` — a cursor-paginated, optionally searched page of collections. */
export async function fetchCollectionsPage(
  query: CollectionsListQuery,
): Promise<FetchCollectionsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.query !== undefined) params.set("query", query.query);
  const qs = params.toString();

  const result = await getAdminApi(
    `/api/v1/collections${qs === "" ? "" : `?${qs}`}`,
    (value): value is PageDto<CollectionDto> => isPageDto<CollectionDto>(value),
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export type FetchCollectionResult =
  | { readonly outcome: "ok"; readonly collection: CollectionDto }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /collections/:collectionId`. */
export async function fetchCollection(id: string): Promise<FetchCollectionResult> {
  const result = await getAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}`,
    isCollectionDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", collection: result.data };
  return result;
}

export interface CollectionMembersQuery {
  readonly first?: number;
  readonly after?: string;
}

export type FetchCollectionMembersResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly CollectionMemberDto[];
      readonly pageInfo: CollectionsPageInfo;
    }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /collections/:collectionId/products` — one page of the collection's members, in collection
 * order, each with its global `position`. The cursor is the index of the last returned item.
 */
export async function fetchCollectionMembers(
  id: string,
  query: CollectionMembersQuery = {},
): Promise<FetchCollectionMembersResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  const qs = params.toString();

  const result = await getAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}/products${qs === "" ? "" : `?${qs}`}`,
    (value): value is PageDto<CollectionMemberDto> => isPageDto<CollectionMemberDto>(value),
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  return result;
}

export interface CreateCollectionInput {
  readonly name: string;
  readonly slug: string;
}

/** `POST /collections` (`collections:create`, idempotent). */
export function createCollection(
  input: CreateCollectionInput,
  idempotencyKey: string,
): Promise<MutationResult<{ id: string }>> {
  return mutateAdminApi(
    "/api/v1/collections",
    { method: "POST", body: input, idempotencyKey },
    isCreated,
  );
}

/** `POST /collections/:collectionId` (`collections:update`) — rename. */
export function renameCollection(
  id: string,
  name: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}`,
    { method: "POST", body: { name }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /collections/:collectionId/products` (`collections:update`) — add a member. */
export function addCollectionProduct(
  id: string,
  productId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}/products`,
    { method: "POST", body: { productId }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /collections/:collectionId/products/:productId/delete` (`collections:update`). */
export function removeCollectionProduct(
  id: string,
  productId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}/products/${encodeURIComponent(productId)}/delete`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** `POST /collections/:collectionId/reorder` (`collections:update`) — the complete permutation. */
export function reorderCollectionProducts(
  id: string,
  productIds: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}/reorder`,
    { method: "POST", body: { productIds }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /collections/:collectionId/publish` (`collections:publish`). */
export function publishCollection(
  id: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}/publish`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** `POST /collections/:collectionId/unpublish` (`collections:publish`). */
export function unpublishCollection(
  id: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}/unpublish`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** `POST /collections/:collectionId/delete` (`collections:delete`). */
export function deleteCollection(
  id: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/collections/${encodeURIComponent(id)}/delete`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}
