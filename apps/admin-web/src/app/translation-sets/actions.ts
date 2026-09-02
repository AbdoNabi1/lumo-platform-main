"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createTranslationSet,
  publishTranslation,
  setTranslation,
} from "@/lib/api/localization";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.11a — the Translation Sets screens' write actions (`app/translation-sets/new/page.tsx`,
 * `app/translation-sets/[translationSetId]/page.tsx`). No update or delete route exists for a
 * translation entry beyond upsert/publish, per the task brief. Same shape every write action in
 * this app follows (`apps/admin-web/README.md`'s recipe): parse `FormData` defensively (never
 * trust a hidden field — re-derive `translationSetId` from the submission itself), mint exactly
 * one idempotency key per submit, call the typed `lib/api/localization.ts` function, and project
 * any non-`ok` outcome through `toFormState`.
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

function revalidateTranslationSetScreens(translationSetId: string): void {
  revalidatePath("/translation-sets");
  revalidatePath(`/translation-sets/${translationSetId}`);
}

/** Creates a translation set (`TranslationSetCreateForm`, `app/translation-sets/new/page.tsx`). */
export async function createTranslationSetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const localeRef = stringField(formData, "localeRef");
  const namespace = stringField(formData, "namespace");

  const fieldErrors: Record<string, string> = {};
  if (localeRef.length === 0) fieldErrors["localeRef"] = t.invalid;
  if (namespace.length === 0) fieldErrors["namespace"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createTranslationSet({ localeRef, namespace }, newIdempotencyKey());

  if (result.outcome === "ok") {
    revalidatePath("/translation-sets");
    redirect(`/translation-sets/${result.data.id}`);
  }
  return toFormState(result, t);
}

/** Upserts one translation value (`UpsertTranslationForm`). */
export async function setTranslationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const translationSetId = stringField(formData, "translationSetId");
  const key = stringField(formData, "key");
  const value = stringField(formData, "value");

  if (translationSetId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }
  const fieldErrors: Record<string, string> = {};
  if (key.length === 0) fieldErrors["key"] = t.invalid;
  if (value.length === 0) fieldErrors["value"] = t.invalid;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await setTranslation(translationSetId, { key, value }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateTranslationSetScreens(translationSetId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Publishes a draft translation by key (`PublishRowForm`, offered unconditionally per row). */
export async function publishTranslationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const translationSetId = stringField(formData, "translationSetId");
  const key = stringField(formData, "key");
  if (translationSetId.length === 0 || key.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await publishTranslation(translationSetId, key, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateTranslationSetScreens(translationSetId);
    return { status: "success" };
  }
  return toFormState(result, t);
}
