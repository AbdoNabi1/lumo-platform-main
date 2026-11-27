import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const KB = 1024;
const MB = 1024 * 1024;

/**
 * "812 B", "1.5 KB", "2.0 MB" — one decimal from a kilobyte up, in the locale's digits. `null`
 * (an asset the API holds no size for) is the dictionary's dash.
 */
export function formatFileSize(bytes: number | null, locale: Locale, t: Dictionary): string {
  const f = t.files;
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return f.unknown;
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (bytes >= MB) return `${one.format(bytes / MB)} ${f.units.mb}`;
  if (bytes >= KB) return `${one.format(bytes / KB)} ${f.units.kb}`;
  return `${new Intl.NumberFormat(locale).format(bytes)} ${f.units.bytes}`;
}

/** `image/png` → "PNG", `image/svg+xml` → "SVG"; unknown → the dictionary's dash. */
export function formatFileType(contentType: string | null, t: Dictionary): string {
  if (contentType === null) return t.files.unknown;
  const subtype = contentType.split("/")[1]?.split("+")[0]?.trim();
  return subtype === undefined || subtype.length === 0 ? t.files.unknown : subtype.toUpperCase();
}

/**
 * The day a file was added, in the locale. Pinned to UTC so the server render and the browser agree
 * (a client component rendering a local date would otherwise fail hydration near midnight).
 */
export function formatFileDate(iso: string | null, locale: Locale, t: Dictionary): string {
  if (iso === null) return t.files.unknown;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t.files.unknown;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

/** Whether the API row carries a picture the page can draw. */
export function isImageFile(file: { readonly image: { readonly url: string } | null }): boolean {
  return file.image !== null && file.image.url.length > 0;
}
