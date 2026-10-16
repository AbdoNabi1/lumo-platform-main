import {
  isDiscountDto,
  type DiscountDto,
  type DiscountInput,
  type DiscountsPageInfo,
  type DiscountView,
} from "@/lib/discounts/model";
import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * Phase 2 Part 2 — the admin `/discounts` API (`apps/admin/src/http/discounts-routes.ts`): Shopify's
 * discounts, one facade over Promotions (the rule) and Coupons (the code). Reads need
 * `promotions:read`, every write `promotions:create` and is idempotent. The model (types and type
 * guards) lives in `lib/discounts/model.ts`, server-import-free so client components can share it;
 * it is re-exported here.
 */

export * from "@/lib/discounts/model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface DiscountsPageDto {
  readonly items: readonly DiscountDto[];
  readonly pageInfo: DiscountsPageInfo;
}

function isDiscountsPageDto(value: unknown): value is DiscountsPageDto {
  return (
    isRecord(value) &&
    Array.isArray(value["items"]) &&
    value["items"].every(isDiscountDto) &&
    isRecord(value["pageInfo"])
  );
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export type FetchDiscountsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly DiscountDto[];
      readonly pageInfo: DiscountsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /discounts` — one tab of the list, searched by title or code, cursor-paginated. */
export async function fetchDiscountsPage(query: {
  readonly view?: DiscountView;
  readonly q?: string;
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchDiscountsPageResult> {
  const params = new URLSearchParams();
  if (query.view !== undefined && query.view !== "all") params.set("view", query.view);
  const q = query.q?.trim() ?? "";
  if (q !== "") params.set("q", q);
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/discounts?${params.toString()}`, isDiscountsPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export type FetchDiscountResult =
  | { readonly outcome: "ok"; readonly discount: DiscountDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

function discountPath(discountId: string, suffix = ""): string {
  return `/api/v1/discounts/${encodeURIComponent(discountId)}${suffix}`;
}

/** `GET /discounts/:discountId` — the form's shape. A deleted discount is `not_found`. */
export async function fetchDiscount(discountId: string): Promise<FetchDiscountResult> {
  const result = await getAdminApi(discountPath(discountId), isDiscountDto);
  if (result.outcome === "ok") return { outcome: "ok", discount: result.data };
  return result;
}

/** `POST /discounts` — creates the discount (and its code) and activates it. */
export function createDiscount(
  input: DiscountInput,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    "/api/v1/discounts",
    { method: "POST", body: input, idempotencyKey },
    isDiscountDto,
  );
}

/** `PUT /discounts/:discountId` — every field except the type and the method. */
export function updateDiscount(
  discountId: string,
  input: DiscountInput,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId),
    { method: "PUT", body: input, idempotencyKey },
    isDiscountDto,
  );
}

/** `DELETE /discounts/:discountId` — archives it; it leaves every list. */
export function deleteDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(discountPath(discountId), { method: "DELETE", idempotencyKey }, isUnknown);
}

/** `POST /discounts/:discountId/activate` — resumes a deactivated discount. */
export function activateDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId, "/activate"),
    { method: "POST", idempotencyKey },
    isDiscountDto,
  );
}

/** `POST /discounts/:discountId/deactivate` — Shopify's Deactivate: it stops at once. */
export function deactivateDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId, "/deactivate"),
    { method: "POST", idempotencyKey },
    isDiscountDto,
  );
}
