/**
 * Wave 2a - the vocabulary of Settings > Checkout and Settings > Customer accounts, shared by the
 * server actions and the two forms. Pure data: it never imports the API client, so a "use client"
 * form may take values from it (see `lib/client-boundary.test.ts`). Mirrors the committed backend
 * (`services/checkout/src/domain/checkout-settings.ts`).
 */

export const NAME_MODES = ["required", "optional"] as const;
export const PHONE_MODES = ["required", "optional"] as const;
export const LINE2_MODES = ["hidden", "optional", "required"] as const;
export const MARKETING_EMAIL_PROMPTS = ["hidden", "show", "preselect"] as const;
export const ACCOUNTS_MODES = ["optional", "disabled"] as const;

/** The most of one item a shopper may hold in the cart: a whole number from 1 to 999 (or no limit). */
export const CART_LINE_LIMIT_MIN = 1;
export const CART_LINE_LIMIT_MAX = 999;

export type NameMode = (typeof NAME_MODES)[number];
export type PhoneMode = (typeof PHONE_MODES)[number];
export type Line2Mode = (typeof LINE2_MODES)[number];
export type MarketingEmailPrompt = (typeof MARKETING_EMAIL_PROMPTS)[number];
export type AccountsMode = (typeof ACCOUNTS_MODES)[number];

/** The eight switches, exactly the fields of the API document. */
export interface CheckoutSettingsValues {
  readonly nameMode: NameMode;
  readonly phoneMode: PhoneMode;
  readonly line2Mode: Line2Mode;
  readonly marketingEmailPrompt: MarketingEmailPrompt;
  /** The most of one item a shopper may add; null = no limit. */
  readonly cartLineLimit: number | null;
  readonly requireLogin: boolean;
  readonly accountsMode: AccountsMode;
  readonly showAccountLink: boolean;
}

/** Narrows a form value to one of the allowed strings (a tampered post is refused, never guessed). */
export function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Reads the add-to-cart limit the way the page typed it: a whole number from 1 to 999. Anything
 * else (empty, "abc", "1.5", "0", "1000") is `null` - never sent, because `NaN` would travel as
 * JSON `null` and silently mean "no limit".
 */
export function parseCartLineLimit(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const value = Number(text);
  return value >= CART_LINE_LIMIT_MIN && value <= CART_LINE_LIMIT_MAX ? value : null;
}
