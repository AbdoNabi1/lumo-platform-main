import type { MutationResult } from "@/lib/api/client";
import { toFormState, type FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { codeOf } from "./codes";

type Failure = Exclude<MutationResult<unknown>, { readonly outcome: "ok" }>;

/** The codes the Online Store API sends (message prefix or field message) that have their own copy. */
function copyByCode(t: Dictionary): Readonly<Record<string, string>> {
  const p = t.onlineStorePreferences;
  return {
    TOO_LONG: p.tooLong,
    IMAGE_NOT_FOUND: p.imageNotFound,
    PASSWORD_REQUIRED: p.passwordRequired,
    PASSWORD_LENGTH: p.passwordLength,
  };
}

/**
 * A failed Online Store save as the form renders it, in the admin's language and never with the
 * server's own text (the API's messages are English and carry codes):
 * - 409 `VERSION_CONFLICT` (someone else saved) asks for a reload; any other 409 is the same
 *   Idempotency-Key still in flight (a double submit), which is not a lost update.
 * - 422 field codes become per-field copy; unknown codes fall back to the generic "check the
 *   highlighted fields".
 * - Everything else goes through the shared `toFormState`, whose messages are dictionary text.
 *
 * Server only (server actions): it value-imports `lib/api/mutation`, which uses `node:crypto`.
 */
export function saveErrorState(result: Failure, t: Dictionary): FormState {
  const p = t.onlineStorePreferences;
  if (result.outcome === "conflict") {
    const message = codeOf(result.message) === "VERSION_CONFLICT" ? p.conflict : p.inFlight;
    return { status: "error", message, fieldErrors: {} };
  }
  if (result.outcome === "invalid") {
    const copy = copyByCode(t);
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.fields) {
      if (issue.field.length === 0) continue;
      fieldErrors[issue.field] = copy[issue.message] ?? t.formErrors.invalid;
    }
    const code = codeOf(result.message);
    const message = (code === null ? undefined : copy[code]) ?? t.formErrors.invalid;
    return { status: "error", message, fieldErrors };
  }
  return toFormState(result, t.formErrors);
}
