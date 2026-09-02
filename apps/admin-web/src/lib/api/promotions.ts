import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.8 Part B — Promotions (`apps/admin/src/http/promotions-routes.ts`). `GET /promotions` and
 * `GET /promotions/:promotionId` are already fully DTO-mapped on the backend (`PromotionDto`,
 * Phase 4 T4.5) — the read side here follows `lib/api/products.ts`'s
 * `fetchProductsPage`/`fetchProduct` pattern exactly, since the DTO is just as flat. The 4 write
 * routes don't map their responses through `toPromotionDto` (`admin.promotions.create`/`.advance`
 * return the `Promotion` aggregate directly) — same discipline as every other Phase 5 write route:
 * read only an `id` off a create response, nothing off `advance`, and let the caller
 * `revalidatePath` to pick up the real, DTO-mapped state.
 */

export interface PromotionDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly ruleType: string;
  readonly scope: string;
  readonly targetRefs: readonly string[];
  readonly minimumQuantity: number | null;
  readonly minimumSubtotalAmountMinor: number | null;
  readonly rewardType: string;
  readonly rewardValue: number | null;
  readonly buyQuantity: number | null;
  readonly getQuantity: number | null;
  readonly stackable: boolean;
  readonly priority: number;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly customerRefs: readonly string[] | null;
  readonly segmentRefs: readonly string[] | null;
  readonly campaignRef: string | null;
  readonly usageLimit: number | null;
  readonly usageCount: number;
}

export interface PromotionsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface PromotionsPageDto {
  readonly items: readonly PromotionDto[];
  readonly pageInfo: PromotionsPageInfo;
}

function isPromotionsPageDto(value: unknown): value is PromotionsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isPromotionDto(value: unknown): value is PromotionDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export type FetchPromotionsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly PromotionDto[];
      readonly pageInfo: PromotionsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of promotions (`GET /promotions`, `promotions:read`). */
export async function fetchPromotionsPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchPromotionsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/promotions?${params.toString()}`,
    isPromotionsPageDto,
  );
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

export type FetchPromotionResult =
  | { readonly outcome: "ok"; readonly promotion: PromotionDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single promotion (`GET /promotions/:promotionId`, `promotions:read`). */
export async function fetchPromotion(promotionId: string): Promise<FetchPromotionResult> {
  const result = await getAdminApi(
    `/api/v1/promotions/${encodeURIComponent(promotionId)}`,
    isPromotionDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", promotion: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreatedRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

export interface CreatePromotionInput {
  readonly name: string;
  readonly ruleType: "automatic" | "buy_x_get_y";
  readonly scope: "cart" | "product" | "category";
  readonly targetRefs: readonly string[];
  readonly minimumQuantity?: number;
  readonly minimumSubtotalAmountMinor?: number;
  readonly rewardType: "percentage" | "fixed_amount" | "free_shipping";
  readonly rewardValue?: number;
  readonly buyQuantity?: number;
  readonly getQuantity?: number;
  readonly stackable: boolean;
  readonly priority: number;
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly customerRefs?: readonly string[];
  readonly segmentRefs?: readonly string[];
  readonly campaignRef?: string;
  readonly usageLimit?: number;
}

/** `POST /promotions` (`idempotent: true`, `promotions:create`). */
export async function createPromotion(
  input: CreatePromotionInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/promotions",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

export type PromotionStatusValue =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "expired"
  | "depleted"
  | "cancelled"
  | "archived";

/** `POST /promotions/:promotionId/transitions` (`idempotent: true`, `promotions:advance`). */
export function advancePromotion(
  promotionId: string,
  toStatus: PromotionStatusValue,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/promotions/${encodeURIComponent(promotionId)}/transitions`,
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

export interface EvaluateCartLineInput {
  readonly productRef: string;
  readonly categoryRefs: readonly string[];
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
}

export interface EvaluatePromotionsInput {
  readonly cart: {
    readonly lines: readonly EvaluateCartLineInput[];
    readonly subtotalAmountMinor: number;
  };
  readonly customerRef: string;
  readonly segmentRefs?: readonly string[];
}

export interface PromotionDeterminationDto {
  readonly promotionId: string;
  readonly discountAmountMinor: number;
  readonly stackable: boolean;
  readonly priority: number;
}

interface EvaluatePromotionsResultDto {
  readonly determinations: readonly PromotionDeterminationDto[];
}

function isEvaluatePromotionsResultDto(value: unknown): value is EvaluatePromotionsResultDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { determinations?: unknown }).determinations)
  );
}

/**
 * `POST /promotions/evaluate` (`promotions:evaluate`) — **not** `idempotent: true` on the backend
 * (see `promotions-routes.ts`), so this deliberately sends no `Idempotency-Key`: it's a pure
 * read/simulation against every active promotion, not a mutation a double-submit could corrupt.
 * Still goes through `mutateAdminApi` (it's a POST through the same authenticated client), but
 * the caller must treat the result as a read/preview — never `revalidatePath` anything from it.
 */
export function evaluatePromotions(
  input: EvaluatePromotionsInput,
): Promise<MutationResult<EvaluatePromotionsResultDto>> {
  return mutateAdminApi(
    "/api/v1/promotions/evaluate",
    { method: "POST", body: input },
    isEvaluatePromotionsResultDto,
  );
}

/**
 * `POST /promotions/:promotionId/record-usage` (`promotions:record_usage`) — also **not**
 * `idempotent: true` on the backend, and deliberately so: each call is meant to record one more
 * usage, so a repeat-key dedupe would silently drop a real usage. No body, no `Idempotency-Key`.
 */
export function recordPromotionUsage(promotionId: string): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/promotions/${encodeURIComponent(promotionId)}/record-usage`,
    { method: "POST" },
    isUnknown,
  );
}
