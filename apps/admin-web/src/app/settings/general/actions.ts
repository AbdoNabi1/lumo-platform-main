"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { updateStoreSettings, type WeightUnit } from "@/lib/api/store-settings";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

const WEIGHT_UNITS: readonly string[] = ["kg", "g", "lb", "oz"];

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Plan 3C — saves Settings → General. Same shape every write action follows: parse the form
 * defensively, mint one idempotency key per submit, call the typed `lib/api/store-settings.ts`
 * function, and project any non-`ok` outcome through `toFormState`. The API validates the currency and
 * time zone against its own lists; this only refuses a weight unit it cannot type.
 *
 * A new currency relabels every product price on the server (numbers kept). If that step fails the
 * API answers 500 and this returns the generic error; saving again finishes it, because the relabel is
 * idempotent.
 */
export async function saveStoreSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const dictionary = dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);

  const weightUnit = text(formData, "weightUnit");
  if (!WEIGHT_UNITS.includes(weightUnit)) {
    return {
      status: "error",
      message: dictionary.formErrors.invalid,
      fieldErrors: { weightUnit: dictionary.formErrors.invalid },
    };
  }

  const contactEmail = text(formData, "contactEmail").trim();
  const result = await updateStoreSettings(
    {
      storeName: text(formData, "storeName").trim(),
      contactEmail: contactEmail.length === 0 ? null : contactEmail,
      currency: text(formData, "currency").trim().toUpperCase(),
      timezone: text(formData, "timezone").trim(),
      weightUnit: weightUnit as WeightUnit,
    },
    newIdempotencyKey(),
  );
  if (result.outcome !== "ok") return toFormState(result, dictionary.formErrors);

  revalidatePath("/settings/general");
  return { status: "success" };
}
