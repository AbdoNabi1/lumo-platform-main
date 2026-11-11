import { safeHref } from "@platform/storefront-content";

const BACKSLASH = 92;

/**
 * Control characters, spaces, DEL and backslashes. Browsers strip tabs and newlines inside a URL,
 * so "/<tab>/x" would become "//x", a protocol-relative (off-site) address.
 */
function hasForbiddenChar(url: string): boolean {
  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === BACKSLASH) return true;
  }
  return false;
}

/**
 * An image url that is safe to hand to `next/image`: an `https:`/`http:` address, or a canonical
 * same-site path by the same rule as `safeHref`. No control character, space or backslash anywhere.
 * Anything else (empty, `javascript:`, `data:`, protocol-relative) is null, so the card shows its
 * placeholder instead of crashing or loading it.
 */
export function safeImageSrc(url: unknown): string | null {
  if (typeof url !== "string" || url === "" || hasForbiddenChar(url)) return null;
  if (url.startsWith("/")) {
    const safe = safeHref(url);
    return safe !== null && !safe.external && safe.href === url ? url : null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
