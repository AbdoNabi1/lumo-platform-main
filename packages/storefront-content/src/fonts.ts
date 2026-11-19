/** The six bundled families; each has Arabic and Latin glyphs (spec 1.3). */
export const FONT_KEYS = [
  "ibm-plex-sans-arabic",
  "cairo",
  "tajawal",
  "almarai",
  "readex-pro",
  "amiri",
] as const;
export type FontKey = (typeof FONT_KEYS)[number];

/** The ONLY way a font name reaches CSS: a fixed key → family map. Merchant text never does. */
export const FONT_FAMILIES: Readonly<Record<FontKey, string>> = {
  "ibm-plex-sans-arabic": "IBM Plex Sans Arabic",
  cairo: "Cairo",
  tajawal: "Tajawal",
  almarai: "Almarai",
  "readex-pro": "Readex Pro",
  amiri: "Amiri",
};

const FALLBACK =
  '"IBM Plex Sans Arabic", var(--font-geist, "Geist"), ui-sans-serif, system-ui, sans-serif';

export function fontStack(key: FontKey): string {
  // `isFontKey` also guards callers that skipped validation: a plain lookup of "constructor" would work.
  if (!isFontKey(key) || key === "ibm-plex-sans-arabic") return FALLBACK;
  return `"${FONT_FAMILIES[key]}", ${FALLBACK}`;
}

export function isFontKey(value: unknown): value is FontKey {
  return typeof value === "string" && (FONT_KEYS as readonly string[]).includes(value);
}
