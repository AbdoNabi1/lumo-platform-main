"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect as nextRedirect } from "next/navigation";
import { createRedirect } from "@/lib/api/seo";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.9b — the Redirects write action. `POST /seo/redirects` only creates (no update route exists
 * — a redirect's `active` field is read-only from this task's perspective, see `lib/api/seo.ts`'s
 * doc comment), so unlike Profiles/Robots Policies there is exactly one write action here. Same
 * shape as every other Phase 5 write action.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isRedirectStatusCode(value: number): value is 301 | 302 {
  return value === 301 || value === 302;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

export async function createRedirectAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const fromPath = stringField(formData, "fromPath");
  const toPath = stringField(formData, "toPath");
  const statusCode = Number.parseInt(stringField(formData, "statusCode"), 10);

  if (fromPath.length === 0 || toPath.length === 0 || !isRedirectStatusCode(statusCode)) {
    const fieldErrors: Record<string, string> = {};
    if (fromPath.length === 0) fieldErrors["fromPath"] = t.invalid;
    if (toPath.length === 0) fieldErrors["toPath"] = t.invalid;
    if (!isRedirectStatusCode(statusCode)) fieldErrors["statusCode"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createRedirect({ fromPath, toPath, statusCode }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/seo/redirects");
    nextRedirect("/seo/redirects");
  }

  return toFormState(result, t);
}
