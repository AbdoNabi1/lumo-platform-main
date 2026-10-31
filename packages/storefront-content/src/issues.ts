/** At most this many issues are ever reported, however hostile the document. */
export const MAX_ISSUES = 50;

const MAX_SEGMENT = 64;

/** A merchant-supplied key name as it appears in an issue path: bounded, so a huge key is not echoed. */
export function pathSegment(key: string): string {
  return key.length > MAX_SEGMENT ? `${key.slice(0, MAX_SEGMENT)}...` : key;
}
