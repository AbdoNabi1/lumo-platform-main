import { COUNTRY_CODES } from "@platform/regions";
import type { Locale } from "@/lib/i18n";

/**
 * The countries the shop ships to (`GET /public/shipping/countries`, Plan 3C): the union of its
 * shipping zones' countries, and whether a rest-of-the-world zone covers every other country.
 */
export interface ShippableCountries {
  readonly countries: readonly string[];
  readonly restOfWorld: boolean;
}

export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

/** ISO 3166-1 alpha-2 codes, not names, are what travels to the API. */
export function isCountryCode(value: string): boolean {
  return COUNTRY_CODES.includes(value);
}

/** The country's name in the page's language; the code itself when the runtime has no name for it. */
export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * What the country select offers, sorted by name in the page's language: the shop's zone
 * countries, or every country with a rest-of-the-world zone. `null` (the list could not be
 * loaded) offers none, the same as a shop that ships nowhere yet — checkout fails closed.
 */
export function countryOptions(
  shippable: ShippableCountries | null,
  locale: Locale,
): readonly CountryOption[] {
  if (shippable === null) return [];
  const codes = shippable.restOfWorld ? COUNTRY_CODES : shippable.countries.filter(isCountryCode);
  return [...new Set(codes)]
    .map((code) => ({ code, name: countryName(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Egypt when it is offered, else the first offered country, else none. */
export function defaultCountry(options: readonly CountryOption[]): string {
  if (options.some((option) => option.code === "EG")) return "EG";
  return options[0]?.code ?? "";
}

/** Which word the province field wears: Egypt's governorate, Saudi Arabia's region, an emirate. */
export function provinceLabelKey(country: string): "governorate" | "region" | "emirate" | null {
  if (country === "EG") return "governorate";
  if (country === "SA") return "region";
  if (country === "AE") return "emirate";
  return null;
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
