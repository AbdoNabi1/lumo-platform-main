import { mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.6 — the 7 Pricing write routes (`admin-routes.ts` lines ~1432-1502: price lists, prices, tax
 * classes, pricing rules). There is no `GET` route anywhere in this domain — no list, no
 * get-by-id, for prices, price lists, pricing rules, or tax classes (`docs/plans/BLOCKERS.md`'s
 * T5.6 entry). `createPriceList`/`createPrice`/`createTaxClass`/`createPricingRule`'s handlers
 * return the created aggregate directly (`admin.pricing.create*(...)`, no DTO mapping step — same
 * as `lib/api/products.ts`'s `createProduct`), so each reads only an `id` off the response, same
 * `isCreatedProduct`-style guard. `activatePriceList`/`changePrice`/`publishPrice` read nothing off
 * their responses (`isUnknown`), same as every other Phase 5 status-transition write.
 */

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

/**
 * Same guard `lib/api/products.ts`'s `isCreatedProduct` uses: the response is an untyped domain
 * aggregate, never fully typed on the wire (`docs/plans/README.md` rule 4) — this only confirms
 * it's an object and lets the caller read an `id` off it if present.
 */
function isCreatedPricingRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

function idOf(value: { readonly id?: unknown }): string {
  return typeof value.id === "string" ? value.id : "";
}

export interface CreatePriceListInput {
  readonly name: string;
  readonly currency: string;
}

/** `POST /price-lists` (`idempotent: true`, `pricing:create_price_list`). */
export async function createPriceList(
  input: CreatePriceListInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/price-lists",
    { method: "POST", body: input, idempotencyKey },
    isCreatedPricingRecord,
  );
  if (result.outcome !== "ok") return result;
  return { outcome: "ok", data: { id: idOf(result.data) } };
}

/** `POST /price-lists/:priceListId/activate` (`idempotent: true`, `pricing:activate_price_list`, no body). */
export function activatePriceList(
  priceListId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/price-lists/${encodeURIComponent(priceListId)}/activate`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

export interface CreatePriceInput {
  readonly priceListId: string;
  readonly productId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly compareAtMinor?: number;
  readonly costMinor?: number;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly taxClassRef?: string;
}

/** `POST /prices` (`idempotent: true`, `pricing:create_price`). */
export async function createPrice(
  input: CreatePriceInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/prices",
    { method: "POST", body: input, idempotencyKey },
    isCreatedPricingRecord,
  );
  if (result.outcome !== "ok") return result;
  return { outcome: "ok", data: { id: idOf(result.data) } };
}

export interface ChangePriceInput {
  readonly amountMinor: number;
  readonly currency: string;
  readonly compareAtMinor?: number;
  readonly costMinor?: number;
}

/** `POST /prices/:priceId` (`idempotent: true`, `pricing:change_price`). */
export function changePrice(
  priceId: string,
  input: ChangePriceInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/prices/${encodeURIComponent(priceId)}`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** `POST /prices/:priceId/publish` (`idempotent: true`, `pricing:publish_price`, no body). */
export function publishPrice(
  priceId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/prices/${encodeURIComponent(priceId)}/publish`,
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

export interface CreateTaxClassInput {
  readonly code: string;
  readonly name: string;
}

/** `POST /tax-classes` (`idempotent: true`, `pricing:create_tax_class`). */
export async function createTaxClass(
  input: CreateTaxClassInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/tax-classes",
    { method: "POST", body: input, idempotencyKey },
    isCreatedPricingRecord,
  );
  if (result.outcome !== "ok") return result;
  return { outcome: "ok", data: { id: idOf(result.data) } };
}

export interface CreatePricingRuleInput {
  readonly type: "percentage" | "fixed_amount";
  readonly value: number;
  readonly priority: number;
}

/** `POST /pricing-rules` (`idempotent: true`, `pricing:create_pricing_rule`). */
export async function createPricingRule(
  input: CreatePricingRuleInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/pricing-rules",
    { method: "POST", body: input, idempotencyKey },
    isCreatedPricingRecord,
  );
  if (result.outcome !== "ok") return result;
  return { outcome: "ok", data: { id: idOf(result.data) } };
}
