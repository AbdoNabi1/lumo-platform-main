"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchCategoriesPage } from "@/lib/api/categories";
import { fetchCustomersPage } from "@/lib/api/customers";
import {
  activateDiscount,
  createDiscount,
  deactivateDiscount,
  deleteDiscount,
  updateDiscount,
} from "@/lib/api/discounts";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { fetchProductsPage } from "@/lib/api/products";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { apiFieldToFormField, parseFormValues, toDiscountInput } from "@/lib/discounts/form";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * Phase 2 Part 2 — the Discounts write actions, in the README's recipe: parse `FormData`
 * defensively, mint one `Idempotency-Key` per submit, call `lib/api/discounts.ts`, revalidate, then
 * redirect. The form posts what the merchant typed as one JSON `payload`; it is rebuilt field by
 * field (`parseFormValues`) and converted here with the store's own currency and time zone — never
 * ones the browser sent.
 */

export type TargetKind = "products" | "categories" | "customers";

export interface TargetOption {
  readonly id: string;
  readonly label: string;
  /** A second line: the SKU, the email; null for categories. */
  readonly detail: string | null;
}

export type TargetSearchResult =
  | { readonly outcome: "ok"; readonly items: readonly TargetOption[] }
  | { readonly outcome: "error" };

const SEARCH_LIMIT = 25;

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function readPayload(formData: FormData): unknown {
  try {
    return JSON.parse(stringField(formData, "payload"));
  } catch {
    return null;
  }
}

/** Creates (no `discountId`) or edits a discount. A create opens the new discount's page. */
export async function saveDiscountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const errors = t.discounts.errors;
  const discountId = stringField(formData, "discountId").trim();
  const values = parseFormValues(readPayload(formData));
  if (values === null) return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };

  const settings = await storeSettingsOrDefaults();
  const { input, fieldErrors } = toDiscountInput(values, settings.currency, settings.timezone);
  if (Object.keys(fieldErrors).length > 0) {
    const localized: Record<string, string> = {};
    for (const [field, key] of Object.entries(fieldErrors)) localized[field] = errors[key];
    return { status: "error", message: errors.notSaved, fieldErrors: localized };
  }

  const key = newIdempotencyKey();
  const result =
    discountId === ""
      ? await createDiscount(input, key)
      : await updateDiscount(discountId, input, key);

  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    if (discountId === "") redirect(`/discounts/${encodeURIComponent(result.data.id)}`);
    revalidatePath(`/discounts/${discountId}`);
    return { status: "success" };
  }
  if (result.outcome === "invalid") {
    const localized: Record<string, string> = {};
    for (const issue of result.fields) {
      const field = apiFieldToFormField(issue.field);
      if (field === "") continue;
      localized[field] = /already in use/i.test(issue.message) ? errors.codeTaken : errors.invalid;
    }
    return { status: "error", message: errors.notSaved, fieldErrors: localized };
  }
  return toFormState(result, t.formErrors);
}

/** Shopify's Delete: the discount leaves every list and its code stops working. */
export async function deleteDiscountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const discountId = stringField(formData, "discountId").trim();
  if (discountId === "") return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };

  const result = await deleteDiscount(discountId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    redirect("/discounts");
  }
  return toFormState(result, t.formErrors);
}

/** Deactivate (`active=false`) or Activate (`active=true`). */
export async function setDiscountActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const discountId = stringField(formData, "discountId").trim();
  const active = stringField(formData, "active");
  if (discountId === "" || (active !== "true" && active !== "false")) {
    return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
  }

  const key = newIdempotencyKey();
  const result =
    active === "true"
      ? await activateDiscount(discountId, key)
      : await deactivateDiscount(discountId, key);
  if (result.outcome === "ok") {
    revalidatePath("/discounts");
    revalidatePath(`/discounts/${discountId}`);
    return { status: "success" };
  }
  return toFormState(result, t.formErrors);
}

/**
 * The Browse dialogs' search. A read, run on the server like every runtime API call: the picker in
 * the browser only ever sees ids, names and a second line.
 */
export async function searchDiscountTargetsAction(
  kind: TargetKind,
  query: string,
): Promise<TargetSearchResult> {
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (kind === "products") {
    const result = await fetchProductsPage({
      first: SEARCH_LIMIT,
      ...(q === "" ? {} : { query: q }),
    });
    if (result.outcome !== "ok") return { outcome: "error" };
    return {
      outcome: "ok",
      items: result.items.map((item) => ({ id: item.id, label: item.name, detail: item.sku })),
    };
  }
  if (kind === "categories") {
    // Categories have no search route; a store's categories fit in one page.
    const result = await fetchCategoriesPage({ first: 100 });
    if (result.outcome !== "ok") return { outcome: "error" };
    const needle = q.toLocaleLowerCase();
    return {
      outcome: "ok",
      items: result.items
        .filter((item) => needle === "" || item.name.toLocaleLowerCase().includes(needle))
        .slice(0, SEARCH_LIMIT)
        .map((item) => ({ id: item.id, label: item.name, detail: null })),
    };
  }
  if (kind === "customers") {
    const result = await fetchCustomersPage({
      first: SEARCH_LIMIT,
      ...(q === "" ? {} : { search: q }),
    });
    if (result.outcome !== "ok") return { outcome: "error" };
    return {
      outcome: "ok",
      items: result.items.map((item) => ({
        id: item.id,
        label: item.name === "" ? item.email : item.name,
        detail: item.email,
      })),
    };
  }
  return { outcome: "error" };
}
