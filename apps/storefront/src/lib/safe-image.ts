/**
 * An image url that is safe to hand to `next/image`: an `http(s):` address or a same-site path
 * (one leading `/`, never `//`). Anything else (empty, `javascript:`, `data:`, protocol-relative) is
 * null, so the card shows its placeholder instead of crashing or loading it.
 */
export function safeImageSrc(url: unknown): string | null {
  if (typeof url !== "string" || url.trim() === "" || url !== url.trim()) return null;
  if (url.startsWith("/")) return url.startsWith("//") || url.includes("\\") ? null : url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
