"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  advancePromotion,
  createPromotion,
  evaluatePromotions,
  recordPromotionUsage,
  type EvaluateCartLineInput,
  type PromotionDeterminationDto,
  type PromotionStatusValue,
} from "@/lib/api/promotions";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.8 Part B — the Promotions write actions. `createPromotionAction`/`advancePromotionAction`
 * follow `app/products/actions.ts`'s reference shape exactly (parse `FormData` defensively, mint
 * one `Idempotency-Key` per invocation, `revalidatePath` on `ok`, otherwise `toFormState`).
 * `evaluatePromotionsAction`/`recordPromotionUsageAction` deliberately deviate — see each one's own
 * doc comment.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

/** `"a, b, c"` -> `["a", "b", "c"]`, empty/blank -> `undefined` (an omitted optional array field). */
function optionalStringListField(formData: FormData, name: string): readonly string[] | undefined {
  const raw = stringField(formData, name).trim();
  if (raw.length === 0) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length === 0 ? undefined : values;
}

function optionalIntField(formData: FormData, name: string): number | undefined | null {
  const raw = optionalStringField(formData, name);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function isPromotionStatus(value: string): value is PromotionStatusValue {
  return (
    value === "draft" ||
    value === "scheduled" ||
    value === "active" ||
    value === "paused" ||
    value === "expired" ||
    value === "depleted" ||
    value === "cancelled" ||
    value === "archived"
  );
}

function isPromotionRuleType(value: string): value is "automatic" | "buy_x_get_y" {
  return value === "automatic" || value === "buy_x_get_y";
}

function isPromotionScope(value: string): value is "cart" | "product" | "category" {
  return value === "cart" || value === "product" || value === "category";
}

function isPromotionRewardType(
  value: string,
): value is "percentage" | "fixed_amount" | "free_shipping" {
  return value === "percentage" || value === "fixed_amount" || value === "free_shipping";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createPromotionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const name = stringField(formData, "name");
  const ruleTypeRaw = stringField(formData, "ruleType");
  const scopeRaw = stringField(formData, "scope");
  const rewardTypeRaw = stringField(formData, "rewardType");
  const targetRefs = optionalStringListField(formData, "targetRefs") ?? [];
  const startsAt = stringField(formData, "startsAt");
  const endsAt = optionalStringField(formData, "endsAt");
  const campaignRef = optionalStringField(formData, "campaignRef");
  const customerRefs = optionalStringListField(formData, "customerRefs");
  const segmentRefs = optionalStringListField(formData, "segmentRefs");

  const minimumQuantity = optionalIntField(formData, "minimumQuantity");
  const minimumSubtotalAmountMinor = optionalIntField(formData, "minimumSubtotalAmountMinor");
  const rewardValueRaw = optionalStringField(formData, "rewardValue");
  const rewardValue = rewardValueRaw === undefined ? undefined : Number.parseFloat(rewardValueRaw);
  const buyQuantity = optionalIntField(formData, "buyQuantity");
  const getQuantity = optionalIntField(formData, "getQuantity");
  const priorityRaw = stringField(formData, "priority");
  const priority = Number.parseInt(priorityRaw, 10);
  const usageLimit = optionalIntField(formData, "usageLimit");
  const stackable = formData.get("stackable") === "on";

  const fieldErrors: Record<string, string> = {};
  if (name.length === 0) fieldErrors["name"] = t.invalid;
  if (!isPromotionRuleType(ruleTypeRaw)) fieldErrors["ruleType"] = t.invalid;
  if (!isPromotionScope(scopeRaw)) fieldErrors["scope"] = t.invalid;
  if (!isPromotionRewardType(rewardTypeRaw)) fieldErrors["rewardType"] = t.invalid;
  if (targetRefs.length === 0) fieldErrors["targetRefs"] = t.invalid;
  if (startsAt.length === 0) fieldErrors["startsAt"] = t.invalid;
  if (Number.isNaN(priority)) fieldErrors["priority"] = t.invalid;
  if (minimumQuantity === null) fieldErrors["minimumQuantity"] = t.invalid;
  if (minimumSubtotalAmountMinor === null) fieldErrors["minimumSubtotalAmountMinor"] = t.invalid;
  if (rewardValueRaw !== undefined && Number.isNaN(rewardValue)) fieldErrors["rewardValue"] = t.invalid;
  if (buyQuantity === null) fieldErrors["buyQuantity"] = t.invalid;
  if (getQuantity === null) fieldErrors["getQuantity"] = t.invalid;
  if (usageLimit === null) fieldErrors["usageLimit"] = t.invalid;

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createPromotion(
    {
      name,
      ruleType: ruleTypeRaw as "automatic" | "buy_x_get_y",
      scope: scopeRaw as "cart" | "product" | "category",
      targetRefs,
      minimumQuantity: minimumQuantity ?? undefined,
      minimumSubtotalAmountMinor: minimumSubtotalAmountMinor ?? undefined,
      rewardType: rewardTypeRaw as "percentage" | "fixed_amount" | "free_shipping",
      rewardValue,
      buyQuantity: buyQuantity ?? undefined,
      getQuantity: getQuantity ?? undefined,
      stackable,
      priority,
      startsAt,
      endsAt,
      customerRefs,
      segmentRefs,
      campaignRef,
      usageLimit: usageLimit ?? undefined,
    },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/promotions");
    const id = result.data.id;
    redirect(id.length > 0 ? `/promotions/${id}` : "/promotions");
  }

  return toFormState(result, t);
}

export async function advancePromotionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const promotionId = stringField(formData, "promotionId");
  const toStatus = stringField(formData, "toStatus");

  if (promotionId.length === 0 || !isPromotionStatus(toStatus)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await advancePromotion(promotionId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/promotions");
    revalidatePath(`/promotions/${promotionId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Records one usage of a promotion. Deliberately mints no `Idempotency-Key` — `recordPromotionUsage`
 * calls the non-idempotent backend route on purpose (see its own doc comment): each click should
 * record one more usage, not be deduplicated.
 */
export async function recordPromotionUsageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const promotionId = stringField(formData, "promotionId");
  if (promotionId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await recordPromotionUsage(promotionId);
  if (result.outcome === "ok") {
    revalidatePath(`/promotions/${promotionId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** What the Evaluate panel renders — a preview result, never routed through `toFormState`/`revalidatePath` (this is a read, not a mutation). */
export type EvaluateFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly determinations: readonly PromotionDeterminationDto[] }
  | { readonly status: "error"; readonly message: string };

/**
 * Evaluates every active promotion against a cart snapshot the operator types in — a "try it out"
 * simulation, not a mutation (see `evaluatePromotions`'s own doc comment). Renders the raw
 * determinations back to the panel; never `revalidatePath`s anything, since nothing changed.
 */
export async function evaluatePromotionsAction(
  _previous: EvaluateFormState,
  formData: FormData,
): Promise<EvaluateFormState> {
  const t = await formErrorDictionary();

  const customerRef = stringField(formData, "customerRef");
  const subtotalRaw = stringField(formData, "subtotalAmountMinor");
  const subtotalAmountMinor = Number.parseInt(subtotalRaw, 10);
  const segmentRefs = optionalStringListField(formData, "segmentRefs");

  if (customerRef.length === 0 || Number.isNaN(subtotalAmountMinor)) {
    return { status: "error", message: t.invalid };
  }

  // The panel renders a small fixed set of line rows (see `PromotionEvaluatePanel`) — a blank
  // `lineProductRef` means that row was left unused, not a validation failure, so it's skipped
  // rather than rejected. A row with a `productRef` but a malformed quantity/price IS an error.
  const productRefs = stringFieldValues(formData, "lineProductRef");
  const categoryRefsRaw = stringFieldValues(formData, "lineCategoryRefs");
  const quantities = stringFieldValues(formData, "lineQuantity");
  const unitPrices = stringFieldValues(formData, "lineUnitPriceAmountMinor");

  const lines: EvaluateCartLineInput[] = [];
  for (let index = 0; index < productRefs.length; index += 1) {
    const productRef = (productRefs[index] ?? "").trim();
    if (productRef.length === 0) continue;
    const categoryRefs = (categoryRefsRaw[index] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const quantity = Number.parseInt(quantities[index] ?? "", 10);
    const unitPriceAmountMinor = Number.parseInt(unitPrices[index] ?? "", 10);
    if (Number.isNaN(quantity) || Number.isNaN(unitPriceAmountMinor)) {
      return { status: "error", message: t.invalid };
    }
    lines.push({ productRef, categoryRefs, quantity, unitPriceAmountMinor });
  }

  const result = await evaluatePromotions({
    cart: { lines, subtotalAmountMinor },
    customerRef,
    segmentRefs,
  });

  if (result.outcome === "ok") {
    return { status: "success", determinations: result.data.determinations };
  }
  if (result.outcome === "unauthorized") return { status: "error", message: t.unauthorized };
  if (result.outcome === "forbidden") return { status: "error", message: t.forbidden };
  if (result.outcome === "not_found") return { status: "error", message: t.notFound };
  if (result.outcome === "conflict") return { status: "error", message: result.message };
  if (result.outcome === "invalid") return { status: "error", message: result.message };
  return { status: "error", message: t.unexpected };
}
