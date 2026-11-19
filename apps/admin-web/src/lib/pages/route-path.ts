import { pageHandleOfPath, type LocalizedText } from "@platform/storefront-content";

/** The longest slug a title gives (Ruling 19); the storefront's handle allows up to 100. */
const SLUG_MAX = 60;
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 4;

/** Four random lower-case letters or digits, for a title with no Latin words. */
export function randomRouteToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  // 256 is not a multiple of 36; the slight bias is harmless for an editable suggestion.
  return [...bytes].map((byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]).join("");
}

/** `[a-z0-9]` runs joined by `-` (accents dropped, not the letters), at most 60, no edge dash. */
function slugOf(text: string): string {
  const runs = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  if (runs === null) return "";
  return runs.join("-").slice(0, SLUG_MAX).replace(/-+$/, "");
}

/**
 * Ruling 19: a page address from its title. A Latin title (English first, then Latin words in the
 * Arabic one) is slugified; anything else (an Arabic-only title) becomes `page-<4 random>`. There
 * is no transliteration table, and the address stays editable.
 */
export function routePathFromTitle(
  title: LocalizedText,
  random: () => string = randomRouteToken,
): string {
  const slug = slugOf(title.en ?? "") || slugOf(title.ar ?? "");
  return `/pages/${slug === "" ? `page-${random()}` : slug}`;
}

/** A path the storefront serves as a page: `/pages/<handle>` under the shared handle rule. */
export function isStorefrontPagePath(path: string): boolean {
  return pageHandleOfPath(path) !== null;
}
