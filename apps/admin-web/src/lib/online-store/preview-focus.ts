import { SECTION_FOCUS_MESSAGE, SECTION_PREVIEW_READY_MESSAGE } from "@platform/storefront-content";

/**
 * What the storefront's focus listener posts to its parent when it is framed and ready (Task 8).
 * The editor answers it with the current selection (F3).
 */
export const PREVIEW_READY_MESSAGE = SECTION_PREVIEW_READY_MESSAGE;

/** The origin of a preview url; null for anything that is not an http(s) url. Never a token. */
export function previewOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Asks the preview frame to scroll to a section (Ruling 18). The target origin is always the
 * preview's own, never `"*"`; without a frame, a window or a usable url nothing is posted.
 */
export function postFocus(
  frame: Pick<HTMLIFrameElement, "contentWindow"> | null,
  previewUrl: string,
  id: string,
): boolean {
  const origin = previewOrigin(previewUrl);
  const target = frame?.contentWindow ?? null;
  if (origin === null || target === null) return false;
  target.postMessage({ type: SECTION_FOCUS_MESSAGE, id }, origin);
  return true;
}
