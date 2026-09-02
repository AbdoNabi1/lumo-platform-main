"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createCategory, deleteCategory, moveCategory } from "@/lib/api/categories";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.7 — same shape as `app/products/actions.ts`'s reference write actions: parse `FormData`
 * defensively, mint one `Idempotency-Key` per invocation, call the typed `lib/api/categories.ts`
 * function, `revalidatePath("/categories")` on `ok`, otherwise `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const name = stringField(formData, "name");
  const slug = stringField(formData, "slug");
  const parentId = optionalStringField(formData, "parentId");

  if (name.length === 0 || slug.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (slug.length === 0) fieldErrors["slug"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createCategory({ name, slug, parentId }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/categories");
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function moveCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const categoryId = stringField(formData, "categoryId");
  if (categoryId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const newParentId = optionalStringField(formData, "newParentId") ?? null;

  const result = await moveCategory(categoryId, newParentId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/categories");
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function deleteCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const categoryId = stringField(formData, "categoryId");
  if (categoryId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await deleteCategory(categoryId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/categories");
    return { status: "success" };
  }
  return toFormState(result, t);
}
