import {
  ACCOUNTS_MODES,
  LINE2_MODES,
  MARKETING_EMAIL_PROMPTS,
  NAME_MODES,
  PHONE_MODES,
  isOneOf,
  type CheckoutSettingsValues,
} from "@/lib/checkout-settings-model";
import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * Wave 2a - Settings > Checkout and Settings > Customer accounts. One settings document per shop
 * (`GET/POST /checkout/settings`): both pages read and save the same eight switches, each page
 * changing its own and sending the rest back as it read them.
 */

/** `GET /checkout/settings`: the values in force (today's behaviour when never saved) and the lock version. */
export interface CheckoutSettingsDto extends CheckoutSettingsValues {
  /** The version a save must send back; null while the shop has never saved any (no row yet). */
  readonly version: number | null;
}

function isCheckoutSettingsDto(value: unknown): value is CheckoutSettingsDto {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isOneOf(NAME_MODES, c["nameMode"]) &&
    isOneOf(PHONE_MODES, c["phoneMode"]) &&
    isOneOf(LINE2_MODES, c["line2Mode"]) &&
    isOneOf(MARKETING_EMAIL_PROMPTS, c["marketingEmailPrompt"]) &&
    (c["cartLineLimit"] === null || typeof c["cartLineLimit"] === "number") &&
    typeof c["requireLogin"] === "boolean" &&
    isOneOf(ACCOUNTS_MODES, c["accountsMode"]) &&
    typeof c["showAccountLink"] === "boolean" &&
    (c["version"] === null || typeof c["version"] === "number")
  );
}

export type FetchCheckoutSettingsResult =
  | { readonly outcome: "ok"; readonly settings: CheckoutSettingsDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches the shop's checkout and customer-account settings (defaults and `version: null` if never saved). */
export async function fetchCheckoutSettings(): Promise<FetchCheckoutSettingsResult> {
  const result = await getAdminApi("/api/v1/checkout/settings", isCheckoutSettingsDto);
  if (result.outcome === "ok") return { outcome: "ok", settings: result.data };
  if (result.outcome === "error") return { outcome: "error", message: result.message };
  return result;
}

/**
 * Saves the whole document. `expectedVersion` is the version the page loaded (null when it loaded
 * the defaults): a stale one is a 409, never an overwrite. A rule the server refuses (a limit out
 * of range, login required while accounts are off) is a 422 naming the field.
 */
export function saveCheckoutSettings(
  values: CheckoutSettingsValues,
  expectedVersion: number | null,
  idempotencyKey: string,
): Promise<MutationResult<CheckoutSettingsDto>> {
  return mutateAdminApi(
    "/api/v1/checkout/settings",
    { method: "POST", body: { ...values, expectedVersion }, idempotencyKey },
    isCheckoutSettingsDto,
  );
}
