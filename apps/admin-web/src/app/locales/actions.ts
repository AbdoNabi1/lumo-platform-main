"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createLocale } from "@/lib/api/localization";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.11a — the Locales create screen's write action (`app/locales/new/page.tsx`). No update or
 * delete route exists for locales (per the task brief), so this is the domain's only write action.
 * Same shape every write action in this app follows (`apps/admin-web/README.md`'s recipe): parse
 * `FormData` defensively, mint exactly one idempotency key per submit, call the typed
 * `lib/api/localization.ts` function, and project any non-`ok` outcome through `toFormState`.
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

/** Registers a locale (`LocaleCreateForm`, `app/locales/new/page.tsx`). */
export async function createLocaleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const code = stringField(formData, "code");
  const name = stringField(formData, "name");
  const isDefault = formData.get("isDefault") === "on";
  const fallbackLocaleRef = optionalStringField(formData, "fallbackLocaleRef");

  const fieldErrors: Record<string, string> = {};
  if (code.length === 0) fieldErrors["code"] = t.invalid;
  if (name.length === 0) fieldErrors["name"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createLocale(
    { code, name, isDefault, fallbackLocaleRef },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/locales");
    redirect(`/locales/${result.data.id}`);
  }
  return toFormState(result, t);
}
