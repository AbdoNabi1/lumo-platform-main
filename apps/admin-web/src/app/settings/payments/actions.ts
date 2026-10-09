"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { fetchPaymentSettings, updateEnabledPaymentMethods } from "@/lib/api/payments";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Plan 3A — saves which payment methods the storefront offers. Same shape every write action in this
 * app follows: parse the form defensively, mint one idempotency key per submit, call the typed
 * `lib/api/payments.ts` function, and project any non-`ok` outcome through `toFormState`.
 *
 * The browser's list is never trusted on its own: keys the platform does not register are dropped
 * (read from `GET /payments/settings`), and an empty set is refused here before any request, the
 * same rule the form enforces and the API enforces (`enabledMethods` has a minimum of one).
 */
export async function savePaymentMethodsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const dictionary = dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);

  const requested = [
    ...new Set(
      formData.getAll("method").filter((value): value is string => typeof value === "string"),
    ),
  ];
  const keepOne: FormState = {
    status: "error",
    message: dictionary.paymentSettings.keepOne,
    fieldErrors: {},
  };
  if (requested.length === 0) return keepOne;

  const current = await fetchPaymentSettings();
  if (current.outcome !== "ok") return toFormState(current, dictionary.formErrors);

  const methods = requested.filter((key) => key in current.settings.methods);
  if (methods.length === 0) return keepOne;

  const result = await updateEnabledPaymentMethods(methods, newIdempotencyKey());
  if (result.outcome !== "ok") return toFormState(result, dictionary.formErrors);

  revalidatePath("/settings/payments");
  return { status: "success" };
}
