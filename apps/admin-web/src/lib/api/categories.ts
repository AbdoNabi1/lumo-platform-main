import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
}

export interface CategoriesPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface CategoriesPageDto {
  readonly items: readonly CategoryDto[];
  readonly pageInfo: CategoriesPageInfo;
}

function isCategoriesPageDto(value: unknown): value is CategoriesPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export interface CategoriesListQuery {
  readonly first?: number;
  readonly after?: string;
}

export type FetchCategoriesPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly CategoryDto[];
      readonly pageInfo: CategoriesPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of categories (`GET /categories`, T5.7). Flat, DTO-mapped. */
export async function fetchCategoriesPage(
  query: CategoriesListQuery,
): Promise<FetchCategoriesPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/categories?${params.toString()}`, isCategoriesPageDto);
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

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly slug: string;
  readonly parentId?: string;
}

/** `POST /categories` (`idempotent: true`, `categories:create`). */
export function createCategory(
  input: CreateCategoryInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/categories",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** `POST /categories/:categoryId/move` (`idempotent: true`, `categories:update`) — reparent. */
export function moveCategory(
  categoryId: string,
  newParentId: string | null,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/categories/${encodeURIComponent(categoryId)}/move`,
    { method: "POST", body: { newParentId }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /categories/:categoryId/delete` (`idempotent: true`, `categories:delete`) — soft-delete. */
export function deleteCategory(
  categoryId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/categories/${encodeURIComponent(categoryId)}/delete`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}
