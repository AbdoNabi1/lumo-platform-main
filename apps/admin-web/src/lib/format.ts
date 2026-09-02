import type { Locale } from "./i18n";

/**
 * Locale-aware formatting. Everything numeric on the dashboard goes through here so the
 * Arabic surface gets real localisation — Arabic-Indic digits, locale decimal separators,
 * and correctly placed currency symbols — rather than English strings in a flipped layout.
 */

export function formatCurrency(locale: Locale, amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/** Compact currency for axis ticks — "$80K" / "٨٠ ألف US$". */
export function formatCurrencyCompact(
  locale: Locale,
  amountMinor: number,
  currency: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(locale: Locale, fraction: number, fractionDigits = 2): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(fraction);
}

/** Signed percentage for period-over-period deltas — "+18.2%" / "−1.2%". */
export function formatDelta(locale: Locale, fraction: number): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction);
}

/** "2 minutes ago" / "منذ دقيقتين", picking the largest unit that fits. */
export function formatRelativeMinutes(locale: Locale, minutesAgo: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutesAgo < 60) return rtf.format(-minutesAgo, "minute");
  if (minutesAgo < 60 * 24) return rtf.format(-Math.round(minutesAgo / 60), "hour");
  return rtf.format(-Math.round(minutesAgo / (60 * 24)), "day");
}

export function formatDateRange(locale: Locale, startIso: string, endIso: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  return formatter.formatRange(new Date(startIso), new Date(endIso));
}

export function formatShortDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(iso));
}

/** "Jan 5, 2026, 3:45 PM" / the Arabic equivalent — used where a full timestamp matters (order timeline, order detail). */
export function formatDateTime(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
