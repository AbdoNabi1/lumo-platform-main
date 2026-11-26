"use server";

import {
  savePageSettings,
  currentDictionary,
  readExpectedVersion,
} from "@/lib/checkout-settings-save";
import type { CheckoutSettingsSaveState } from "@/lib/checkout-settings-save";
import {
  CART_LINE_LIMIT_MAX,
  CART_LINE_LIMIT_MIN,
  LINE2_MODES,
  MARKETING_EMAIL_PROMPTS,
  NAME_MODES,
  PHONE_MODES,
  isOneOf,
  parseCartLineLimit,
} from "@/lib/checkout-settings-model";
import type { FormState } from "@/lib/api/mutation";

/**
 * Wave 2a - Settings > Checkout. Reads the page's switches defensively (a mode that is not one of
 * the allowed strings is refused, never guessed), turns the add-to-cart limit into a number or null
 * (a typed limit that is not a whole number from 1 to 999 is refused here: `NaN` would travel as
 * JSON null and quietly mean "no limit"), then saves through the shared helper, which sends the
 * Customer accounts switches back unchanged with the version the page loaded.
 */
export async function saveCheckoutSettingsAction(
  _previous: CheckoutSettingsSaveState,
  formData: FormData,
): Promise<CheckoutSettingsSaveState> {
  const dictionary = await currentDictionary();
  const invalid = (fieldErrors: Record<string, string> = {}): FormState => ({
    status: "error",
    message: dictionary.formErrors.invalid,
    fieldErrors,
  });

  const expectedVersion = readExpectedVersion(formData);
  if (expectedVersion === undefined) return invalid();

  const nameMode = formData.get("nameMode");
  const phoneMode = formData.get("phoneMode");
  const line2Mode = formData.get("line2Mode");
  const marketingEmailPrompt = formData.get("marketingEmailPrompt");
  if (!isOneOf(NAME_MODES, nameMode)) return invalid({ nameMode: dictionary.formErrors.invalid });
  if (!isOneOf(PHONE_MODES, phoneMode))
    return invalid({ phoneMode: dictionary.formErrors.invalid });
  if (!isOneOf(LINE2_MODES, line2Mode))
    return invalid({ line2Mode: dictionary.formErrors.invalid });
  if (!isOneOf(MARKETING_EMAIL_PROMPTS, marketingEmailPrompt)) {
    return invalid({ marketingEmailPrompt: dictionary.formErrors.invalid });
  }

  let cartLineLimit: number | null = null;
  if (formData.get("cartLimitOn") === "on") {
    const typed = formData.get("cartLineLimit");
    cartLineLimit = typeof typed === "string" ? parseCartLineLimit(typed) : null;
    if (cartLineLimit === null) {
      return invalid({
        cartLineLimit: dictionary.checkoutSettings.limitInvalid
          .replace("{min}", String(CART_LINE_LIMIT_MIN))
          .replace("{max}", String(CART_LINE_LIMIT_MAX)),
      });
    }
  }

  return savePageSettings(
    {
      nameMode,
      phoneMode,
      line2Mode,
      marketingEmailPrompt,
      cartLineLimit,
      // A switch that is off (or disabled while accounts are off) posts nothing.
      requireLogin: formData.get("requireLogin") === "on",
    },
    expectedVersion,
    dictionary,
  );
}
