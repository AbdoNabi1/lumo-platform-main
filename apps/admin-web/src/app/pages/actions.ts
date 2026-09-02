"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { advancePage, createPage } from "@/lib/api/pages";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9a Part B — the Pages write actions. Same shape as `app/products/actions.ts`'s reference
 * actions: parse `FormData` defensively, mint one `Idempotency-Key` per invocation, call the typed
 * `lib/api/pages.ts` function, `revalidatePath` the stale surfaces on `ok`, otherwise `toFormState`.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Empty string -> `undefined` (an omitted optional zod field), not a validation failure. */
function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name).trim();
  return value.length === 0 ? undefined : value;
}

function isPageStatus(value: string): value is "draft" | "published" | "archived" {
  return value === "draft" || value === "published" || value === "archived";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createPageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const name = stringField(formData, "name");
  const routePath = stringField(formData, "routePath");
  const templateRef = optionalStringField(formData, "templateRef");
  const experienceRef = optionalStringField(formData, "experienceRef");
  const seoProfileRef = optionalStringField(formData, "seoProfileRef");
  const localeRef = optionalStringField(formData, "localeRef");

  if (name.length === 0 || routePath.length === 0) {
    const fieldErrors: Record<string, string> = {};
    if (name.length === 0) fieldErrors["name"] = t.invalid;
    if (routePath.length === 0) fieldErrors["routePath"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createPage(
    { name, routePath, templateRef, experienceRef, seoProfileRef, localeRef },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/pages");
    const id = result.data.id;
    redirect(id.length > 0 ? `/pages/${id}` : "/pages");
  }

  return toFormState(result, t);
}

export async function advancePageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const pageId = stringField(formData, "pageId");
  const toStatus = stringField(formData, "toStatus");

  if (pageId.length === 0 || !isPageStatus(toStatus)) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await advancePage(pageId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/pages");
    revalidatePath(`/pages/${pageId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}
