/**
 * The countries the checkout offers (ISO 3166-1 alpha-2). Codes, not names, are what travels to
 * the API: they are the only form a tax or shipping provider can key on. The names live in the
 * message files, one per locale.
 */
export const CHECKOUT_COUNTRIES = [
  "EG",
  "SA",
  "AE",
  "KW",
  "QA",
  "BH",
  "OM",
  "JO",
  "LB",
  "IQ",
  "MA",
  "TN",
  "DZ",
  "LY",
  "SD",
  "US",
  "GB",
  "DE",
  "FR",
  "CA",
] as const;

export type CheckoutCountry = (typeof CHECKOUT_COUNTRIES)[number];

export const DEFAULT_CHECKOUT_COUNTRY: CheckoutCountry = "EG";

export function isCheckoutCountry(value: string): value is CheckoutCountry {
  return (CHECKOUT_COUNTRIES as readonly string[]).includes(value);
}

/** Arabic-Indic (U+0660–0669) and Persian (U+06F0–06F9) digits to ASCII; spaces, dashes and brackets dropped. */
export function normalizePhone(raw: string): string {
  return raw
    .replace(/[٠-٩۰-۹]/g, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/[\s\-()]/g, "");
}

/**
 * The same rule the API applies (`CheckoutAddress`): 7 to 15 digits, optionally led by `+`. Checked
 * here only so a bad number is caught before any request; the API stays the authority.
 */
export function isValidPhone(raw: string): boolean {
  return /^\+?[0-9]{7,15}$/.test(normalizePhone(raw));
}
