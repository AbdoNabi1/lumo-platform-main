import type { Locale } from "./i18n";
import { currencyExponent } from "./money";

/**
 * Locale-aware money formatting — real currency symbols and digit shaping per locale. Plan 2B-1:
 * scales by the currency's own minor-unit exponent (EGP 2, JPY 0, KWD 3), not a fixed 100.
 */
export function formatCurrency(locale: Locale, amountMinor: number, currency: string): string {
  const digits = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}
