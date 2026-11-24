import type { SegmentView } from "@/lib/api/customer-segments";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * A segment's display name: a custom segment's own name, a default segment's localized label
 * (`t.segments.defaults.<key>`; an unknown future key falls back to the key itself).
 */
export function segmentDisplayName(
  segment: Pick<SegmentView, "id" | "kind" | "key" | "name">,
  t: Dictionary,
): string {
  if (segment.kind === "custom") return segment.name ?? segment.id;
  const labels = t.segments.defaults as Readonly<Record<string, string>>;
  return (segment.key !== null ? labels[segment.key] : undefined) ?? segment.key ?? segment.id;
}

/** "1 customer" / "3 customers" / "عميلان" — the plural form comes from the locale's own rules. */
export function customerCountLabel(count: number, locale: Locale, t: Dictionary): string {
  const category = new Intl.PluralRules(locale).select(count);
  return t.segments.customerCount[category].replace("{count}", formatNumber(locale, count));
}

/** A route segment as the app router hands it over: ids like `default:not_purchased` may arrive percent-encoded. */
export function decodeSegmentId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function segmentHref(segmentId: string): string {
  return `/customers/segments/${encodeURIComponent(segmentId)}`;
}

/**
 * The ONLY failure that means "this store has no database for live segments": the API answered
 * 503 with the `UNAVAILABLE` code. Any other error is a generic failure.
 */
export function isSegmentsUnavailable(error: {
  readonly status?: number;
  readonly code?: string;
}): boolean {
  return error.status === 503 && error.code === "UNAVAILABLE";
}
