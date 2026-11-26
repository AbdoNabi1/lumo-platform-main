"use server";

import {
  savePageSettings,
  currentDictionary,
  readExpectedVersion,
} from "@/lib/checkout-settings-save";
import type { CheckoutSettingsSaveState } from "@/lib/checkout-settings-save";
import { ACCOUNTS_MODES, isOneOf } from "@/lib/checkout-settings-model";

/**
 * Wave 2a - Settings > Customer accounts. Saves the accounts switch and the account-link switch;
 * the Checkout page's switches (including "require sign-in") go back unchanged. Turning accounts
 * off while sign-in is required is refused by the API (422, field `requireLogin`) and shown.
 */
export async function saveCustomerAccountsAction(
  _previous: CheckoutSettingsSaveState,
  formData: FormData,
): Promise<CheckoutSettingsSaveState> {
  const dictionary = await currentDictionary();
  const invalid = (field?: string): CheckoutSettingsSaveState => ({
    status: "error",
    message: dictionary.formErrors.invalid,
    fieldErrors: field === undefined ? {} : { [field]: dictionary.formErrors.invalid },
  });

  const expectedVersion = readExpectedVersion(formData);
  if (expectedVersion === undefined) return invalid();

  const accountsMode = formData.get("accountsMode");
  if (!isOneOf(ACCOUNTS_MODES, accountsMode)) return invalid("accountsMode");

  return savePageSettings(
    { accountsMode, showAccountLink: formData.get("showAccountLink") === "on" },
    expectedVersion,
    dictionary,
  );
}
