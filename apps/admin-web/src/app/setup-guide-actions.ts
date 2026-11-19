"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { dismissSetupGuide } from "@/lib/api/store-settings";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Home's setup guide, "Dismiss". One idempotency key per submit; a non-ok outcome goes through
 * `toFormState` so the card can say why. On success Home is revalidated, so the guide is gone from
 * the next render (the dismissal is remembered by the API, not by the browser).
 */
export async function dismissSetupGuideAction(
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);

  const result = await dismissSetupGuide(newIdempotencyKey());
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);

  revalidatePath("/");
  return { status: "success" };
}
