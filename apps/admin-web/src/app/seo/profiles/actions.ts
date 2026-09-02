"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSeoProfile } from "@/lib/api/seo";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9b — the SEO Profiles write action. `POST /seo/profiles` is create-or-update keyed by
 * `pageRef` (`seo-routes.ts`'s `setSeoProfileBody`), so this one action serves both the create
 * screen and, via the detail page's "edit" link (pre-filled with the same `pageRef`), a
 * re-submission that updates the existing record — same shape as every other Phase 5 write action:
 * parse `FormData` defensively, mint one `Idempotency-Key` per invocation, call the typed
 * `lib/api/seo.ts` function, `revalidatePath` the stale surfaces on `ok`, otherwise `toFormState`.
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

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function setSeoProfileAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const pageRef = stringField(formData, "pageRef");
  const title = optionalStringField(formData, "title");
  const description = optionalStringField(formData, "description");
  const canonicalUrl = optionalStringField(formData, "canonicalUrl");
  const ogImageRef = optionalStringField(formData, "ogImageRef");

  if (pageRef.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: { pageRef: t.invalid } };
  }

  const result = await setSeoProfile(
    { pageRef, title, description, canonicalUrl, ogImageRef },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/seo/profiles");
    const id = result.data.id;
    redirect(id.length > 0 ? `/seo/profiles/${id}` : "/seo/profiles");
  }

  return toFormState(result, t);
}
