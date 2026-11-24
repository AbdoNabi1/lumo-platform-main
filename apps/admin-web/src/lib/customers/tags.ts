/** Latin and Arabic commas both separate tags, like the API's own splitting. */
const SEPARATORS = /[,\u060C]/;

/** `"VIP, Cairo،  gold"` → `["VIP", "Cairo", "gold"]`: trimmed, no blanks. */
export function splitTags(raw: string): string[] {
  return raw
    .split(SEPARATORS)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

const keyOf = (tag: string): string => tag.toLowerCase();

/** Appends `additions` to `existing`, skipping any tag already present (case-insensitive); the first spelling wins. */
export function mergeTags(existing: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...existing, ...additions]) {
    const key = keyOf(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged;
}

/** True when both lists hold the same tags, ignoring order and case. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(keyOf));
  return keys.size === new Set(b.map(keyOf)).size && b.every((tag) => keys.has(keyOf(tag)));
}
