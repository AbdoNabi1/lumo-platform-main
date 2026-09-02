"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createBrand, deleteBrand, updateBrand } from "@/lib/api/brands";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.7 — same shape as `app/products/actions.ts`'s reference write actions: parse `FormData`
 * defensively, mint one `Idempotency-Key` per invocation, call the typed `lib/api/brands.ts`
 * function, `revalidatePath("/brands")` on `ok`, otherwise `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const name = stringField(formData, "name");
  const slug = stringField(formData, "slug");

  if (name.length === 0 || slug.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (slug.length === 0) fieldErrors["slug"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createBrand({ name, slug }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/brands");
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function updateBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const brandId = stringField(formData, "brandId");
  const name = stringField(formData, "name");
  if (brandId.length === 0 || name.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: name.length === 0 ? { name: t.invalid } : {},
    };
  }

  const result = await updateBrand(brandId, name, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/brands");
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function deleteBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const brandId = stringField(formData, "brandId");
  if (brandId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await deleteBrand(brandId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/brands");
    return { status: "success" };
  }
  return toFormState(result, t);
}
