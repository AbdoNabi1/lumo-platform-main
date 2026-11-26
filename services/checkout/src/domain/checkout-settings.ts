import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

/**
 * Wave 2a (Settings > Checkout and Settings > Customer accounts): the per-shop switches the checkout,
 * the cart and the customer sign-in routes honour. Every default below is TODAY's live behaviour
 * (D33), so a shop that never saves these settings behaves exactly as it always did.
 */

export const NAME_MODES = ["required", "optional"] as const;
export const PHONE_MODES = ["required", "optional"] as const;
export const LINE2_MODES = ["hidden", "optional", "required"] as const;
export const MARKETING_EMAIL_PROMPTS = ["hidden", "show", "preselect"] as const;
export const ACCOUNTS_MODES = ["optional", "disabled"] as const;

export type NameMode = (typeof NAME_MODES)[number];
export type PhoneMode = (typeof PHONE_MODES)[number];
export type Line2Mode = (typeof LINE2_MODES)[number];
export type MarketingEmailPrompt = (typeof MARKETING_EMAIL_PROMPTS)[number];
export type AccountsMode = (typeof ACCOUNTS_MODES)[number];

export const CART_LINE_LIMIT_MIN = 1;
export const CART_LINE_LIMIT_MAX = 999;

export interface CheckoutSettingsValues {
  readonly nameMode: NameMode;
  readonly phoneMode: PhoneMode;
  readonly line2Mode: Line2Mode;
  readonly marketingEmailPrompt: MarketingEmailPrompt;
  /** The most of one item a shopper may hold in the cart; null = no limit. */
  readonly cartLineLimit: number | null;
  readonly requireLogin: boolean;
  readonly accountsMode: AccountsMode;
  readonly showAccountLink: boolean;
}

/** D33: what a shop with no settings row gets (name and phone required, line 2 optional, nothing else on). */
export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettingsValues = Object.freeze({
  nameMode: "required",
  phoneMode: "required",
  line2Mode: "optional",
  marketingEmailPrompt: "hidden",
  cartLineLimit: null,
  requireLogin: false,
  accountsMode: "optional",
  showAccountLink: true,
});

/** A settings row as stored: the values and the optimistic-lock counter the admin page sends back. */
export interface StoredCheckoutSettings {
  readonly values: CheckoutSettingsValues;
  readonly version: number;
}

export const SETTINGS_STALE_MESSAGE = "These settings were changed by someone else";
export const LOGIN_NEEDS_ACCOUNTS_MESSAGE = "Customer accounts must be on to require login";

type Issue = { readonly field: string; readonly message: string };

function oneOf<T extends string>(
  issues: Issue[],
  field: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  issues.push({ field, message: `must be one of: ${allowed.join(", ")}` });
  return undefined;
}

function bool(issues: Issue[], field: string, value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  issues.push({ field, message: "must be true or false" });
  return undefined;
}

/**
 * Checks a whole settings document and returns ONE `ValidationError` naming every field that is
 * wrong. The same combinations the table's CHECK constraints refuse are refused here first, with a
 * message the merchant can read (`requireLogin` while accounts are disabled).
 */
export function validateCheckoutSettings(
  input: unknown,
): Result<CheckoutSettingsValues, ValidationError> {
  const issues: Issue[] = [];
  const source = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  const nameMode = oneOf(issues, "nameMode", source["nameMode"], NAME_MODES);
  const phoneMode = oneOf(issues, "phoneMode", source["phoneMode"], PHONE_MODES);
  const line2Mode = oneOf(issues, "line2Mode", source["line2Mode"], LINE2_MODES);
  const marketingEmailPrompt = oneOf(
    issues,
    "marketingEmailPrompt",
    source["marketingEmailPrompt"],
    MARKETING_EMAIL_PROMPTS,
  );
  const accountsMode = oneOf(issues, "accountsMode", source["accountsMode"], ACCOUNTS_MODES);
  const requireLogin = bool(issues, "requireLogin", source["requireLogin"]);
  const showAccountLink = bool(issues, "showAccountLink", source["showAccountLink"]);

  const limit = source["cartLineLimit"];
  let cartLineLimit: number | null = null;
  if (limit === null) {
    cartLineLimit = null;
  } else if (
    typeof limit === "number" &&
    Number.isInteger(limit) &&
    limit >= CART_LINE_LIMIT_MIN &&
    limit <= CART_LINE_LIMIT_MAX
  ) {
    cartLineLimit = limit;
  } else {
    issues.push({
      field: "cartLineLimit",
      message: `must be empty or a whole number from ${CART_LINE_LIMIT_MIN} to ${CART_LINE_LIMIT_MAX}`,
    });
  }

  if (requireLogin === true && accountsMode === "disabled") {
    issues.push({ field: "requireLogin", message: LOGIN_NEEDS_ACCOUNTS_MESSAGE });
  }

  if (issues.length > 0) return err(new ValidationError("Invalid checkout settings", issues));
  return ok({
    nameMode: nameMode as NameMode,
    phoneMode: phoneMode as PhoneMode,
    line2Mode: line2Mode as Line2Mode,
    marketingEmailPrompt: marketingEmailPrompt as MarketingEmailPrompt,
    cartLineLimit,
    requireLogin: requireLogin as boolean,
    accountsMode: accountsMode as AccountsMode,
    showAccountLink: showAccountLink as boolean,
  });
}

/** The eight fields the storefront may read, and nothing else. */
export interface PublicCheckoutSettings {
  readonly nameMode: NameMode;
  readonly phoneMode: PhoneMode;
  readonly line2Mode: Line2Mode;
  readonly marketingEmailPrompt: MarketingEmailPrompt;
  readonly cartLineLimit: number | null;
  readonly requireLogin: boolean;
  readonly accountsMode: AccountsMode;
  readonly showAccountLink: boolean;
}

export function toPublicCheckoutSettings(values: CheckoutSettingsValues): PublicCheckoutSettings {
  return {
    nameMode: values.nameMode,
    phoneMode: values.phoneMode,
    line2Mode: values.line2Mode,
    marketingEmailPrompt: values.marketingEmailPrompt,
    cartLineLimit: values.cartLineLimit,
    requireLogin: values.requireLogin,
    accountsMode: values.accountsMode,
    showAccountLink: values.showAccountLink,
  };
}

/** The settings in force: the saved ones, or today's behaviour for a shop that never saved any. */
export function effectiveCheckoutSettings(
  stored: StoredCheckoutSettings | null,
): CheckoutSettingsValues {
  return stored === null ? DEFAULT_CHECKOUT_SETTINGS : stored.values;
}
