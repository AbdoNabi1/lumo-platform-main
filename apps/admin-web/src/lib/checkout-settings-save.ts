import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  fetchCheckoutSettings,
  saveCheckoutSettings,
  type CheckoutSettingsDto,
} from "@/lib/api/checkout-settings";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import type { CheckoutSettingsValues } from "@/lib/checkout-settings-model";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** A settings save's outcome; on success, the version the next save must send. */
export type CheckoutSettingsSaveState =
  FormState | { readonly status: "success"; readonly version: number };

/** Both pages show the same document, so both are refreshed after anything that reached the API. */
export const CHECKOUT_SETTINGS_PATHS = [
  "/settings/checkout",
  "/settings/customer-accounts",
] as const;

export async function currentDictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function valuesOf(settings: CheckoutSettingsDto): CheckoutSettingsValues {
  return {
    nameMode: settings.nameMode,
    phoneMode: settings.phoneMode,
    line2Mode: settings.line2Mode,
    marketingEmailPrompt: settings.marketingEmailPrompt,
    cartLineLimit: settings.cartLineLimit,
    requireLogin: settings.requireLogin,
    accountsMode: settings.accountsMode,
    showAccountLink: settings.showAccountLink,
  };
}

/** The version the page loaded, sent as a hidden field: "" is "no row yet" (null), digits a version. */
export function readExpectedVersion(formData: FormData): number | null | undefined {
  const raw = formData.get("expectedVersion");
  if (typeof raw !== "string") return undefined;
  if (raw === "") return null;
  if (!/^\d{1,9}$/.test(raw)) return undefined;
  const version = Number(raw);
  return version >= 1 ? version : undefined;
}

function refresh(): void {
  for (const path of CHECKOUT_SETTINGS_PATHS) revalidatePath(path);
}

/**
 * Saves one page's switches. The API takes the whole document, so the other page's switches are
 * read fresh and sent back unchanged; the version is the one the page LOADED (never the fresh
 * one), so a page that is out of date gets the 409 instead of overwriting someone else's save.
 * Every outcome that reached the API refreshes both pages.
 */
export async function savePageSettings(
  patch: Partial<CheckoutSettingsValues>,
  expectedVersion: number | null,
  dictionary: Dictionary,
): Promise<CheckoutSettingsSaveState> {
  const current = await fetchCheckoutSettings();
  if (current.outcome !== "ok") {
    refresh();
    return toFormState(current, dictionary.formErrors);
  }

  const result = await saveCheckoutSettings(
    { ...valuesOf(current.settings), ...patch },
    expectedVersion,
    newIdempotencyKey(),
  );
  refresh();

  if (result.outcome === "ok") {
    const version = result.data.version;
    return version === null ? { status: "success" } : { status: "success", version };
  }
  if (result.outcome === "conflict") {
    return {
      status: "error",
      message: dictionary.checkoutSettings.conflict,
      fieldErrors: {},
    };
  }
  return toFormState(result, dictionary.formErrors);
}
