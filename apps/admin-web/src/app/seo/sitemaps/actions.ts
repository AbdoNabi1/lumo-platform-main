"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSitemap, regenerateSitemap } from "@/lib/api/seo";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9b — the Sitemaps write actions. `createSitemapAction` mints a new (empty) sitemap;
 * `regenerateSitemapAction` replaces its `urls` list (`POST /seo/sitemaps/:sitemapId/regenerate`).
 * Same shape as every other Phase 5 write action.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

/**
 * Parses the repeated `url` rows (`SitemapRegenerateForm`'s array field — same technique
 * `OrderLineItemsField`/`app/products/actions.ts`'s `parseVariants` established) into the `urls`
 * list `regenerateSitemapBody` expects. Blank rows are dropped rather than rejected, so an operator
 * can leave trailing empty rows without a validation error; `null` only for a fully-empty list.
 */
function parseUrls(formData: FormData): readonly string[] | null {
  const urls = stringFieldValues(formData, "url")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  return urls.length === 0 ? null : urls;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createSitemapAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const name = stringField(formData, "name");
  if (name.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { name: t.invalid } };
  }

  const result = await createSitemap({ name }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/seo/sitemaps");
    const id = result.data.id;
    redirect(id.length > 0 ? `/seo/sitemaps/${id}` : "/seo/sitemaps");
  }

  return toFormState(result, t);
}

export async function regenerateSitemapAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const sitemapId = stringField(formData, "sitemapId");
  const urls = parseUrls(formData);

  if (sitemapId.length === 0 || urls === null) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: urls === null ? { urls: t.invalid } : {},
    };
  }

  const result = await regenerateSitemap(sitemapId, urls, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/seo/sitemaps");
    revalidatePath(`/seo/sitemaps/${sitemapId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}
