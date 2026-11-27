/** Latin and Arabic commas both separate tags, like the API's own splitting. */
const SEPARATORS = /[,\u060C]/;

/**
 * The display spelling, as Identity stores it (`customer-annotations`): NFC, every run of
 * whitespace one space, trimmed.
 */
export function normalizeTag(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** A tag's identity (Identity's `tagKey`): the normalized spelling, lower-cased. */
export function tagKeyOf(raw: string): string {
  return normalizeTag(raw).toLowerCase();
}

/** `"VIP, Cairo،  gold"` → `["VIP", "Cairo", "gold"]`: normalized, no blanks. */
export function splitTags(raw: string): string[] {
  return raw
    .split(SEPARATORS)
    .map(normalizeTag)
    .filter((tag) => tag.length > 0);
}

const keyOf = tagKeyOf;

/**
 * Appends `additions` to `existing`, skipping any tag already present (same identity as Identity:
 * case, spacing and NFC form ignored); the first spelling wins, shown normalized.
 */
export function mergeTags(existing: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...existing, ...additions]) {
    const tag = normalizeTag(raw);
    if (tag.length === 0) continue;
    const key = keyOf(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged;
}

/** True when both lists hold the same tags, ignoring order, case, spacing and NFC form. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(keyOf));
  return keys.size === new Set(b.map(keyOf)).size && b.every((tag) => keys.has(keyOf(tag)));
}
