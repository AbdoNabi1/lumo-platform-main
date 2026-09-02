import type { Locale } from "./i18n";

/** Locale-aware money formatting — real currency symbols and digit shaping per locale. */
export function formatCurrency(locale: Locale, amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}
