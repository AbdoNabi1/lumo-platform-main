"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { updateCarrier, rotateCarrierWebhookSecret } from "@/lib/api/carriers";
import { newIdempotencyKey, type FormState } from "@/lib/api/mutation";
import type { MutationResult } from "@/lib/api/client";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { CARRIER_KEY, carrierErrorMessage } from "@/lib/shipping/carrier-errors";
import type { Dictionary } from "@/messages/en";

export type CarrierActionState = FormState;
async function dictionary(): Promise<Dictionary> {
  const locale = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(locale) ? locale : DEFAULT_LOCALE);
}
function error(message: string): FormState {
  return { status: "error", message, fieldErrors: {} };
}
function resultState(result: MutationResult<unknown>, t: Dictionary): FormState {
  if (result.outcome === "ok") {
    revalidatePath("/settings/shipping");
    return { status: "success" };
  }
  if (result.outcome === "unauthorized") return error(t.formErrors.unauthorized);
  if (result.outcome === "forbidden") return error(t.formErrors.forbidden);
  if (result.outcome === "not_found") return error(t.formErrors.notFound);
  if (result.outcome === "invalid" && result.code === "VALIDATION")
    return error(t.formErrors.invalid);
  return error(carrierErrorMessage(result.code, t, "settings"));
}
export async function saveCarrierAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  try {
    const key = formData.get("carrierKey");
    const apiKey = formData.get("apiKey");
    const awbFormat = formData.get("awbFormat");
    const awbLanguage = formData.get("awbLanguage");
    if (
      typeof key !== "string" ||
      !CARRIER_KEY.test(key) ||
      typeof apiKey !== "string" ||
      apiKey.length > 512 ||
      (awbFormat !== "A6" && awbFormat !== "A4") ||
      (awbLanguage !== "ar" && awbLanguage !== "en")
    )
      return error(t.formErrors.invalid);
    return resultState(
      await updateCarrier(
        key,
        {
          enabled: formData.get("enabled") === "on",
          config: {
            awbFormat,
            awbLanguage,
            allowToOpenPackage: formData.get("allowToOpenPackage") === "on",
          },
          ...(apiKey.trim() ? { credentials: { apiKey: apiKey.trim() } } : {}),
        },
        newIdempotencyKey(),
      ),
      t,
    );
  } catch (caught) {
    unstable_rethrow(caught);
    return error(t.formErrors.unexpected);
  }
}
export async function disconnectCarrierAction(carrierKey: string): Promise<FormState> {
  const t = await dictionary();
  try {
    if (typeof carrierKey !== "string" || !CARRIER_KEY.test(carrierKey))
      return error(t.formErrors.invalid);
    return resultState(
      await updateCarrier(carrierKey, { disconnect: true }, newIdempotencyKey()),
      t,
    );
  } catch (caught) {
    unstable_rethrow(caught);
    return error(t.formErrors.unexpected);
  }
}
export async function rotateCarrierSecretAction(carrierKey: string): Promise<FormState> {
  const t = await dictionary();
  try {
    if (typeof carrierKey !== "string" || !CARRIER_KEY.test(carrierKey))
      return error(t.formErrors.invalid);
    return resultState(await rotateCarrierWebhookSecret(carrierKey, newIdempotencyKey()), t);
  } catch (caught) {
    unstable_rethrow(caught);
    return error(t.formErrors.unexpected);
  }
}
