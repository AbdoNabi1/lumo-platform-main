import {
  SECTION_FOCUS_MESSAGE,
  SECTION_ID_PATTERN,
  SECTION_PREVIEW_READY_MESSAGE,
} from "@platform/storefront-content";

/** The editor asks the preview to scroll to a section: the one shared message name (F12). */
export const FOCUS_MESSAGE_TYPE = SECTION_FOCUS_MESSAGE;
/** The preview tells its parent (the editor) that it can now take focus messages. */
export const PREVIEW_READY_MESSAGE = SECTION_PREVIEW_READY_MESSAGE;

/**
 * The section a focus message names, or null. Accepted only from the admin's origin, sent by this
 * page's parent window, with the one message type and a section id (a uuid, so it is safe in an
 * attribute selector). Anything else, from anyone else, does nothing (Review Focus 3).
 */
export function focusTargetOf(
  event: { readonly origin: string; readonly source: unknown; readonly data: unknown },
  adminOrigin: string,
  parent: unknown,
): string | null {
  if (event.origin !== adminOrigin || event.source !== parent) return null;
  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const { type, id } = data as { type?: unknown; id?: unknown };
  if (type !== FOCUS_MESSAGE_TYPE) return null;
  return typeof id === "string" && SECTION_ID_PATTERN.test(id) ? id : null;
}
