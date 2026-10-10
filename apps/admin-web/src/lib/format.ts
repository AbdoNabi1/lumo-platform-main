import type { Locale } from "./i18n";
import { currencyExponent } from "./products/money";

/**
 * Locale-aware formatting. Everything numeric on the dashboard goes through here so the
 * Arabic surface gets real localisation — Arabic-Indic digits, locale decimal separators,
 * and correctly placed currency symbols — rather than English strings in a flipped layout.
 */

/** Plan 2B-1: scales by the currency's own minor-unit exponent (EGP 2, JPY 0, KWD 3), not a fixed 100. */
export function formatCurrency(locale: Locale, amountMinor: number, currency: string): string {
  const digits = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
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
  }).format(amountMinor / 10 ** currencyExponent(currency));
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

/**
 * A clock time in the locale — "8:27 pm" in English (lowercase day period, as Shopify writes it),
 * "٨:٢٧ م" in Arabic. Intl separates the day period with a narrow no-break space; a plain space is
 * what a reader (and a test) expects.
 */
export function formatClockTime(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })
    .formatToParts(date)
    .map((part) =>
      part.type === "dayPeriod" && locale === "en" ? part.value.toLowerCase() : part.value,
    )
    .join("")
    .replace(/[\u202f\u00a0]/g, " ");
}

export type OrderDateWhen = "today" | "yesterday" | "other";

export interface OrderDateParts {
  /** Which wording to use: "Today at …", "Yesterday at …", or "{date} at …". */
  readonly when: OrderDateWhen;
  /** The short date, "Oct 7" — used when `when` is "other". */
  readonly date: string;
  /** The clock time, "8:27 pm". */
  readonly time: string;
  /** The full date and time, for a tooltip. */
  readonly full: string;
}

/** The runtime's calendar day as a whole number, so "yesterday" is a calendar day, not 24 hours ago. */
function calendarDay(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/**
 * The pieces of a Shopify-style order date ("Today at 8:27 pm", "Yesterday at …", "Oct 7 at …"). The
 * words around them ("Today", "at") are copy and live in the messages; this only decides which
 * wording applies and formats the date and time in the page locale. A date in the future (clock skew
 * between servers) reads as today rather than inventing a label.
 */
export function orderDateParts(
  locale: Locale,
  iso: string,
  now: Date = new Date(),
): OrderDateParts {
  const placed = new Date(iso);
  const daysAgo = calendarDay(now) - calendarDay(placed);
  return {
    when: daysAgo <= 0 ? "today" : daysAgo === 1 ? "yesterday" : "other",
    date: formatShortDate(locale, iso),
    time: formatClockTime(locale, placed),
    full: formatDateTime(locale, iso),
  };
}

/** "October 9, 2026" / the Arabic equivalent — the order page header's date. */
export function formatLongDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
}
