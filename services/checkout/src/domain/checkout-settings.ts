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

/**
 * What the SERVER holds a shipping address to. A shop with no settings row gets the same server
 * rules it always had (name and phone are optional on the server; only the storefront insists),
 * so existing clients - the admin checkout routes, recovery links, integrations - keep working.
 * The moment the merchant saves the settings, the saved modes bind every caller.
 */
export interface AddressRules {
  readonly nameRequired: boolean;
  readonly phoneRequired: boolean;
  readonly line2: Line2Mode;
  /** Saved settings turn a blank optional name/phone into "not given" instead of an error. */
  readonly blankIsAbsent: boolean;
}

export function addressRulesFor(stored: StoredCheckoutSettings | null): AddressRules {
  if (stored === null) {
    return { nameRequired: false, phoneRequired: false, line2: "optional", blankIsAbsent: false };
  }
  return {
    nameRequired: stored.values.nameMode === "required",
    phoneRequired: stored.values.phoneMode === "required",
    line2: stored.values.line2Mode,
    blankIsAbsent: true,
  };
}

export interface AddressFields {
  readonly name?: string | undefined;
  readonly phone?: string | undefined;
  readonly line2?: string | undefined;
}

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/** Fields the rules say are missing from an address, as validation issues (empty when it complies). */
export function addressRuleIssues(rules: AddressRules, address: AddressFields): Issue[] {
  const issues: Issue[] = [];
  if (rules.nameRequired && blank(address.name))
    issues.push({ field: "name", message: "required" });
  if (rules.phoneRequired && blank(address.phone)) {
    issues.push({ field: "phone", message: "required" });
  }
  if (rules.line2 === "required" && blank(address.line2)) {
    issues.push({ field: "line2", message: "required" });
  }
  return issues;
}

/** A line 2 the shop does not collect is dropped; a blank one is treated as absent once settings are saved. */
export function normalizeAddressInput<T extends AddressFields>(rules: AddressRules, input: T): T {
  let next = input;
  if (rules.line2 === "hidden") next = { ...next, line2: undefined };
  if (rules.blankIsAbsent) {
    if (!rules.nameRequired && blank(next.name)) next = { ...next, name: undefined };
    if (!rules.phoneRequired && blank(next.phone)) next = { ...next, phone: undefined };
    if (blank(next.line2)) next = { ...next, line2: undefined };
  }
  return next;
}

/** `You can add up to <n> of this item` - the one wording the storefront shows for a line over the limit. */
export function cartLimitMessage(limit: number): string {
  return `You can add up to ${limit} of this item`;
}

/** The validation issue for a line quantity over the limit, or null when it fits (or there is no limit). */
export function cartLineLimitIssue(limit: number | null, quantity: number): Issue | null {
  return limit !== null && quantity > limit
    ? { field: "quantity", message: cartLimitMessage(limit) }
    : null;
}
