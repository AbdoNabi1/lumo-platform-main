import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface BrandDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface BrandsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface BrandsPageDto {
  readonly items: readonly BrandDto[];
  readonly pageInfo: BrandsPageInfo;
}

function isBrandsPageDto(value: unknown): value is BrandsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export interface BrandsListQuery {
  readonly first?: number;
  readonly after?: string;
}

export type FetchBrandsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly BrandDto[];
      readonly pageInfo: BrandsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of brands (`GET /brands`, new in T5.7). Flat, DTO-mapped. */
export async function fetchBrandsPage(query: BrandsListQuery): Promise<FetchBrandsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/brands?${params.toString()}`, isBrandsPageDto);
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

export interface CreateBrandInput {
  readonly name: string;
  readonly slug: string;
}

/** `POST /brands` (`idempotent: true`, `brands:create`). */
export function createBrand(
  input: CreateBrandInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi("/api/v1/brands", { method: "POST", body: input, idempotencyKey }, isUnknown);
}

/** `POST /brands/:brandId` (`idempotent: true`, `brands:update`) — rename. */
export function updateBrand(
  brandId: string,
  name: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/brands/${encodeURIComponent(brandId)}`,
    { method: "POST", body: { name }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /brands/:brandId/delete` (`idempotent: true`, `brands:delete`) — soft-delete. */
export function deleteBrand(
  brandId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/brands/${encodeURIComponent(brandId)}/delete`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}
