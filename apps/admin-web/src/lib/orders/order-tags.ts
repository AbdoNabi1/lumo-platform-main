/** Shopify's limits, mirrored from the API (services/orders) so the inputs can say so before saving. */
export const MAX_TAG_LENGTH = 40;
export const MAX_NOTE_LENGTH = 5000;
export const MAX_COMMENT_LENGTH = 5000;
/** The list's "Tagged with" filter takes at most this many tags (the API's cap). */
const MAX_TAG_FILTER = 10;

/** Tags split on the Latin comma and the Arabic comma (U+060C), which an Arabic keyboard types. */
export const TAG_SEPARATOR = /[,،]/u;

/** Characters as a person counts them: an emoji or an Arabic letter is one. */
export function characterCount(text: string): number {
  return [...text].length;
}

/** A tag as the API stores it: NFC, each run of whitespace one space, trimmed. */
export function normalizeTagText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** Whether `tags` already holds `tag`, ignoring case and spacing (the API's tag identity). */
export function hasTag(tags: readonly string[], tag: string): boolean {
  const key = normalizeTagText(tag).toLowerCase();
  return tags.some((existing) => normalizeTagText(existing).toLowerCase() === key);
}

export interface SplitTags {
  readonly tags: readonly string[];
  /** Entries over {@link MAX_TAG_LENGTH} characters, set aside so the input can say why. */
  readonly tooLong: readonly string[];
}

/**
 * What the merchant typed → tags: a comma (Latin or Arabic) splits (Shopify's rule), blanks drop, a case-insensitive
 * duplicate keeps the first spelling, and an entry over 40 characters is set aside.
 */
export function splitTagInput(raw: string): SplitTags {
  const tags: string[] = [];
  const tooLong: string[] = [];
  for (const part of raw.split(TAG_SEPARATOR)) {
    const tag = normalizeTagText(part);
    if (tag.length === 0) continue;
    if (characterCount(tag) > MAX_TAG_LENGTH) {
      tooLong.push(tag);
      continue;
    }
    if (!hasTag(tags, tag)) tags.push(tag);
  }
  return { tags, tooLong };
}

/** The list URL's `?tag=vip,urgent` (one comma list, or repeated) → at most 10 usable tags. */
export function parseTagFilter(raw: string | readonly string[] | undefined): readonly string[] {
  if (raw === undefined) return [];
  const joined = typeof raw === "string" ? raw : raw.join(",");
  return splitTagInput(joined).tags.slice(0, MAX_TAG_FILTER);
}
