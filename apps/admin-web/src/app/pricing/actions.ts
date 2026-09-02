"use server";

import { cookies } from "next/headers";
import { newIdempotencyKey, toFormState, type FormErrorDictionary, type FormState } from "@/lib/api/mutation";
import {
  activatePriceList,
  changePrice,
  createPrice,
  createPriceList,
  createPricingRule,
  createTaxClass,
  publishPrice,
} from "@/lib/api/pricing";
import type { MutationResult } from "@/lib/api/client";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.6 — the Pricing operations console's 7 write actions (`app/pricing/page.tsx`). Same shape
 * every write action in this app follows (`app/products/actions.ts`'s own reference doc comment):
 * parse `FormData` defensively, mint one `Idempotency-Key` per submit, call the typed
 * `lib/api/pricing.ts` function, and project any non-`ok` outcome through `toFormState`.
 *
 * This domain has no read/list route at all (`docs/plans/BLOCKERS.md`'s T5.6 entry), so there is
 * nothing to `revalidatePath` — unlike every other Phase 5 write screen, a successful create here
 * has no list/detail page anywhere in the app that would show it. The one thing an operator gets
 * back is the created id itself, which `createPriceListAction`/`createPriceAction`/
 * `createTaxClassAction`/`createPricingRuleAction` return in `CreateFormState.createdId` so the
 * form can render it — see the task brief's "no browsing back to it later" ruling.
 */

/** Same success shape as `FormState`, plus the created record's id for the four create forms. */
export type CreateFormState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly createdId: string }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
    };

/**
 * `toFormState` is only ever reached below after the caller has already excluded the `"ok"`
 * outcome (same early-return-then-fall-through shape `createProductAction` uses), so its
 * `"success"` branch is unreachable here — but the type checker doesn't know that from the call
 * site, so this narrows at runtime instead of casting.
 */
function toCreateFormState(
  result: MutationResult<unknown>,
  t: FormErrorDictionary,
): CreateFormState {
  const state = toFormState(result, t);
  return state.status === "success" ? { status: "idle" } : state;
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

function intField(formData: FormData, name: string): number {
  return Number.parseInt(stringField(formData, name), 10);
}

/** Empty string -> `undefined` (an omitted optional zod field), a non-empty non-number -> `NaN`. */
function optionalIntField(formData: FormData, name: string): number | undefined {
  const raw = stringField(formData, name).trim();
  return raw.length === 0 ? undefined : Number.parseInt(raw, 10);
}

function floatField(formData: FormData, name: string): number {
  return Number.parseFloat(stringField(formData, name));
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createPriceListAction(
  _previous: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const t = await formErrorDictionary();
  const name = stringField(formData, "name");
  const currency = stringField(formData, "currency");

  if (name.length === 0 || currency.length !== 3) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (currency.length !== 3) fieldErrors["currency"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createPriceList({ name, currency }, newIdempotencyKey());
  if (result.outcome === "ok") {
    return { status: "success", createdId: result.data.id };
  }
  return toCreateFormState(result, t);
}

export async function activatePriceListAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const priceListId = stringField(formData, "priceListId");
  if (priceListId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { priceListId: t.invalid } };
  }

  const result = await activatePriceList(priceListId, newIdempotencyKey());
  if (result.outcome === "ok") {
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function createPriceAction(
  _previous: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const t = await formErrorDictionary();
  const priceListId = stringField(formData, "priceListId");
  const productId = stringField(formData, "productId");
  const amountMinor = intField(formData, "amountMinor");
  const currency = stringField(formData, "currency");
  const compareAtMinor = optionalIntField(formData, "compareAtMinor");
  const costMinor = optionalIntField(formData, "costMinor");
  const effectiveFrom = optionalStringField(formData, "effectiveFrom");
  const effectiveTo = optionalStringField(formData, "effectiveTo");
  const taxClassRef = optionalStringField(formData, "taxClassRef");

  const fieldErrors: Record<string, string> = {};
  if (priceListId.length === 0) fieldErrors["priceListId"] = t.invalid;
  if (productId.length === 0) fieldErrors["productId"] = t.invalid;
  if (Number.isNaN(amountMinor) || amountMinor <= 0) fieldErrors["amountMinor"] = t.invalid;
  if (currency.length !== 3) fieldErrors["currency"] = t.invalid;
  if (compareAtMinor !== undefined && (Number.isNaN(compareAtMinor) || compareAtMinor <= 0)) {
    fieldErrors["compareAtMinor"] = t.invalid;
  }
  if (costMinor !== undefined && (Number.isNaN(costMinor) || costMinor < 0)) {
    fieldErrors["costMinor"] = t.invalid;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createPrice(
    {
      priceListId,
      productId,
      amountMinor,
      currency,
      compareAtMinor,
      costMinor,
      effectiveFrom,
      effectiveTo,
      taxClassRef,
    },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    return { status: "success", createdId: result.data.id };
  }
  return toCreateFormState(result, t);
}

export async function changePriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const priceId = stringField(formData, "priceId");
  const amountMinor = intField(formData, "amountMinor");
  const currency = stringField(formData, "currency");
  const compareAtMinor = optionalIntField(formData, "compareAtMinor");
  const costMinor = optionalIntField(formData, "costMinor");

  const fieldErrors: Record<string, string> = {};
  if (priceId.length === 0) fieldErrors["priceId"] = t.invalid;
  if (Number.isNaN(amountMinor) || amountMinor <= 0) fieldErrors["amountMinor"] = t.invalid;
  if (currency.length !== 3) fieldErrors["currency"] = t.invalid;
  if (compareAtMinor !== undefined && (Number.isNaN(compareAtMinor) || compareAtMinor <= 0)) {
    fieldErrors["compareAtMinor"] = t.invalid;
  }
  if (costMinor !== undefined && (Number.isNaN(costMinor) || costMinor < 0)) {
    fieldErrors["costMinor"] = t.invalid;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await changePrice(
    priceId,
    { amountMinor, currency, compareAtMinor, costMinor },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function publishPriceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const priceId = stringField(formData, "priceId");
  if (priceId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { priceId: t.invalid } };
  }

  const result = await publishPrice(priceId, newIdempotencyKey());
  if (result.outcome === "ok") {
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function createTaxClassAction(
  _previous: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const t = await formErrorDictionary();
  const code = stringField(formData, "code");
  const name = stringField(formData, "name");

  if (code.length === 0 || name.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (code.length === 0) fieldErrors["code"] = t.invalid;
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createTaxClass({ code, name }, newIdempotencyKey());
  if (result.outcome === "ok") {
    return { status: "success", createdId: result.data.id };
  }
  return toCreateFormState(result, t);
}

function isPricingRuleType(value: string): value is "percentage" | "fixed_amount" {
  return value === "percentage" || value === "fixed_amount";
}

export async function createPricingRuleAction(
  _previous: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const t = await formErrorDictionary();
  const rawType = stringField(formData, "type");
  const value = floatField(formData, "value");
  const priority = intField(formData, "priority");

  const fieldErrors: Record<string, string> = {};
  if (!isPricingRuleType(rawType)) fieldErrors["type"] = t.invalid;
  if (Number.isNaN(value)) fieldErrors["value"] = t.invalid;
  if (Number.isNaN(priority)) fieldErrors["priority"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0 || !isPricingRuleType(rawType)) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createPricingRule({ type: rawType, value, priority }, newIdempotencyKey());
  if (result.outcome === "ok") {
    return { status: "success", createdId: result.data.id };
  }
  return toCreateFormState(result, t);
}
