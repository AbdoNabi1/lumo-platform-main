export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Merchant text in both storefront languages. Empty string never stored: absent means "not written". */
export interface LocalizedText {
  readonly ar?: string;
  readonly en?: string;
}

/** One problem found while reading merchant content. `code` is a stable machine code. */
export interface ContentIssue {
  readonly path: string;
  readonly code: string;
}

/** Shown in the request locale, else the other locale, else nothing (the element is omitted). */
export function pickText(text: LocalizedText, locale: Locale): string | null {
  const own = text[locale];
  if (own !== undefined && own.length > 0) return own;
  const other = text[locale === "ar" ? "en" : "ar"];
  return other !== undefined && other.length > 0 ? other : null;
}

// Unicode bidi embedding/override (U+202A–U+202E) and isolate (U+2066–U+2069) characters. Rendering
// isolates merchant text itself (`<bdi dir="auto">`); a stored override could flip the page around it.
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
const LINE_BREAKS_AND_TABS = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;
// eslint-disable-next-line no-control-regex -- removing these characters is the purpose
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/** Plain text as the platform stores it: trimmed, no control or bidi override characters. */
export function normalizePlainText(
  value: string,
  options: { readonly multiline?: boolean } = {},
): string {
  let text = value.replace(BIDI_CONTROLS, "");
  if (options.multiline === true) {
    text = text.replace(/\r\n?/g, "\n").replace(CONTROLS, "");
  } else {
    text = text.replace(LINE_BREAKS_AND_TABS, " ").replace(CONTROLS, "");
  }
  return text.trim();
}

/** Reads `{ ar?, en? }` from untrusted input, normalising each value and reporting by path. */
export function normalizeLocalizedText(
  raw: unknown,
  options: { readonly path: string; readonly max: number; readonly multiline?: boolean },
  issues: ContentIssue[],
): LocalizedText {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push({ path: options.path, code: "INVALID_VALUE" });
    return {};
  }
  const result: { ar?: string; en?: string } = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const path = `${options.path}.${key}`;
    if (key !== "ar" && key !== "en") {
      issues.push({ path, code: "UNKNOWN_KEY" });
      continue;
    }
    if (typeof value !== "string") {
      issues.push({ path, code: "INVALID_VALUE" });
      continue;
    }
    const text = normalizePlainText(
      value,
      options.multiline === undefined ? {} : { multiline: options.multiline },
    );
    if (text.length > options.max) issues.push({ path, code: "TOO_LONG" });
    if (text.length > 0) result[key] = text;
  }
  return result;
}
