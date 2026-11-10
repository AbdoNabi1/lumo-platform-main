import type { MutationResult } from "@/lib/api/client";
import { toFormState, type FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { codeOf } from "./codes";
import { isMenuUrlField, menuCodeCopy } from "./menu-copy";

type Failure = Exclude<MutationResult<unknown>, { readonly outcome: "ok" }>;

/**
 * 422 codes (message prefix or field message) with their own copy: the Preferences and access
 * codes (`services/online-store/src/domain/errors.ts`, `access.use-cases.ts`), the theme
 * document's issue codes, the menu codes (`@platform/storefront-content`, Part 2) and the
 * Morbeh-text codes of policy and page content (`body.ar: UNSAFE_LINK`, `title.en: TOO_LONG`).
 */
function invalidCopy(t: Dictionary): Readonly<Record<string, string>> {
  const p = t.onlineStorePreferences;
  const e = t.onlineStoreErrors;
  return {
    ...menuCodeCopy(t),
    TOO_LONG: p.tooLong,
    IMAGE_NOT_FOUND: p.imageNotFound,
    PASSWORD_REQUIRED: p.passwordRequired,
    PASSWORD_LENGTH: p.passwordLength,
    DOCUMENT_TOO_LARGE: e.documentTooLarge,
    INVALID_URL: e.invalidUrl,
    INVALID_COLOR: e.invalidColor,
    OUT_OF_RANGE: e.outOfRange,
    UNSAFE_LINK: t.richText.unsafeLinkSaved,
  };
}

/** 409 codes with their own copy (`versionConflict`, `draftChanged`, `nothingToPublish`, menus). */
function conflictCopy(t: Dictionary): Readonly<Record<string, string>> {
  const n = t.onlineStoreNavigation;
  return {
    VERSION_CONFLICT: t.onlineStorePreferences.conflict,
    DRAFT_CHANGED: t.onlineStoreErrors.draftChanged,
    NOTHING_TO_PUBLISH: t.onlineStoreErrors.nothingToPublish,
    MENU_PROTECTED: n.protected,
    MENU_IN_USE: n.inUse,
    MENU_HANDLE_TAKEN: n.taken,
    MENU_LIMIT: n.limit,
    PAGE_ARCHIVED: t.pageEditor.archived,
    ROUTE_PATH_TAKEN: t.pageEditor.addressTaken,
  };
}

/** 409 codes that belong to one field of the form (F14: a taken page address). */
const CONFLICT_FIELDS: Readonly<Record<string, string>> = { ROUTE_PATH_TAKEN: "routePath" };

/**
 * A failed Online Store save as the form renders it, in the admin's language and never with the
 * server's own text (the API's messages are English and carry codes):
 * - 409: `VERSION_CONFLICT` (someone else saved) asks for a reload, `DRAFT_CHANGED` asks for a new
 *   preview, `NOTHING_TO_PUBLISH` says so. The duplicate Idempotency-Key answer is the only 409 with
 *   no code prefix: that one is "already in progress". Any other coded 409 is the generic conflict
 *   copy, never mistaken for a double submit. `ROUTE_PATH_TAKEN` (pages) is also put on the
 *   `routePath` field, where the merchant fixes it.
 * - 422 field codes become per-field copy; unknown codes fall back to the generic "check the
 *   highlighted fields". Menu codes (Part 2) are `menu-copy.ts`'s, shared with the editor.
 * - Everything else goes through the shared `toFormState`, whose messages are dictionary text
 *   (404, e.g. `RELEASE_NOT_FOUND`, carries no code through the client and is "not found").
 *
 * Server only (server actions): it value-imports `lib/api/mutation`, which uses `node:crypto`.
 */
export function saveErrorState(result: Failure, t: Dictionary): FormState {
  if (result.outcome === "conflict") {
    const code = codeOf(result.message);
    const message =
      code === null
        ? t.onlineStorePreferences.inFlight
        : (conflictCopy(t)[code] ?? t.formErrors.conflict);
    const field = code === null ? undefined : CONFLICT_FIELDS[code];
    return {
      status: "error",
      message,
      fieldErrors: field === undefined ? {} : { [field]: message },
    };
  }
  if (result.outcome === "invalid") {
    const copy = invalidCopy(t);
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.fields) {
      if (issue.field.length === 0) continue;
      // A menu item's web address has its own wording; social links keep theirs (Part 1).
      const own =
        issue.message === "INVALID_URL" && isMenuUrlField(issue.field)
          ? t.onlineStoreNavigation.urlError
          : copy[issue.message];
      fieldErrors[issue.field] = own ?? t.formErrors.invalid;
    }
    const code = codeOf(result.message);
    const message = (code === null ? undefined : copy[code]) ?? t.formErrors.invalid;
    return { status: "error", message, fieldErrors };
  }
  return toFormState(result, t.formErrors);
}
