"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { updateAccess, updatePreferences } from "@/lib/api/online-store";
import { newIdempotencyKey, type LiveSaveState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { saveErrorState } from "@/lib/online-store/save-errors";
import { revalidateStorefront } from "@/lib/storefront-revalidate";

/** A save's outcome; see `LiveSaveState` for `liveDelayed`. */
export type OnlineStoreSaveState = LiveSaveState;

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const localized = (formData: FormData, name: string) => ({
  ar: text(formData, `${name}.ar`),
  en: text(formData, `${name}.en`),
});
const version = (formData: FormData): number => {
  const n = Number(text(formData, "expectedVersion"));
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

async function dictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

/** After a live-on-save write: refresh this screen, then the storefront's cached shell (best effort). */
async function savedState(): Promise<OnlineStoreSaveState> {
  revalidatePath("/online-store/preferences");
  return (await revalidateStorefront())
    ? { status: "success" }
    : { status: "success", liveDelayed: true };
}

/** Online Store → Preferences (operator and up; the API enforces it). Sends `expectedVersion` (Ruling 33). */
export async function savePreferencesAction(
  _previous: OnlineStoreSaveState,
  formData: FormData,
): Promise<OnlineStoreSaveState> {
  const t = await dictionary();
  const shareImageId = text(formData, "shareImageId").trim();
  const result = await updatePreferences(
    {
      homeTitle: localized(formData, "homeTitle"),
      homeMetaDescription: localized(formData, "homeMetaDescription"),
      shareImageId: shareImageId === "" ? null : shareImageId,
      defaultLocale: text(formData, "defaultLocale") === "en" ? "en" : "ar",
      expectedVersion: version(formData),
    },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return saveErrorState(result, t);
  return savedState();
}

/**
 * Admin only (the API enforces it). An empty password field keeps the current one (Ruling 10); the
 * password is sent once and never returned, logged or put back into the form.
 */
export async function saveAccessAction(
  _previous: OnlineStoreSaveState,
  formData: FormData,
): Promise<OnlineStoreSaveState> {
  const t = await dictionary();
  const password = text(formData, "password");
  const result = await updateAccess(
    {
      locked: formData.get("locked") === "on",
      password: password.trim() === "" ? null : password,
      message: localized(formData, "message"),
      expectedVersion: version(formData),
    },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return saveErrorState(result, t);
  return savedState();
}
