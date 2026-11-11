import {
  IMAGE_ALT_MAX,
  normalizeLocalizedText,
  type LocalizedText,
  type PublicImage,
} from "@platform/storefront-content";

/**
 * The value re-checks every Runtime read shares (spec 1.12 step 3): the shell, content reads and
 * the homepage sections. A leaf module, so `online-store.ts` and `public-sections.ts` can both use
 * it without importing each other; `online-store.ts` re-exports it under its old names.
 */

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const size = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000
    ? value
    : null;

const isDevLocal = (url: URL): boolean =>
  process.env.NODE_ENV === "development" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

/** Cut at `max` UTF-16 units (the admin's own measure) without leaving half a surrogate pair. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A hostile or buggy Runtime must not be able to bloat the cached entry, so every text is capped. */
export function textOf(value: unknown, max: number, multiline = false): LocalizedText {
  const found = normalizeLocalizedText(value, { path: "", max, multiline }, []);
  return {
    ...(found.ar === undefined ? {} : { ar: clip(found.ar, max) }),
    ...(found.en === undefined ? {} : { en: clip(found.en, max) }),
  };
}

/** An `https:` image (an http one is mixed content), except local media in development; else null. */
export function imageOf(value: unknown): PublicImage | null {
  const o = obj(value);
  const url = o["url"];
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isDevLocal(parsed)))
    return null;
  return {
    url: parsed.toString(),
    alt: typeof o["alt"] === "string" ? clip(o["alt"], IMAGE_ALT_MAX) : null,
    width: size(o["width"]),
    height: size(o["height"]),
  };
}
