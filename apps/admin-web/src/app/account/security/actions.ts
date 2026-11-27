"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { MutationResult } from "@/lib/api/client";
import {
  confirmOwnTwoStep,
  disableOwnTwoStep,
  regenerateBackupCodes,
  startOwnTwoStep,
} from "@/lib/api/two-step";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { ownTwoStepConflictKey, type TwoStepSetup } from "@/lib/staff/two-step";
import type { Dictionary } from "@/messages/en";

/**
 * Wave 1e — the member's own two-step actions. Same discipline as `app/settings/users/actions.ts`:
 * `revalidatePath` after EVERY outcome that reached the API (a refusal may still mean the page on
 * screen is stale), and the server's answer mapped onto a locale sentence — nothing it says is shown raw.
 *
 * These calls carry NO idempotency key (the routes are not idempotent on purpose). The TOTP secret,
 * the `otpauth://` link and the backup codes exist only in the value an action RETURNS: they are
 * never put in a URL, a cookie, a log or a revalidated server component, and no action logs a
 * password or a code.
 */

export type TwoStepFailure =
  | "wrong_code"
  | "wrong_password"
  | "policy_required"
  | "platform_required"
  | "already_on"
  | "not_on"
  | "limited"
  | "not_configured"
  | "expired"
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "unexpected";

export type TwoStepActionResult<T> =
  | { readonly status: "ok"; readonly data: T }
  | { readonly status: "error"; readonly reason: TwoStepFailure; readonly message: string };

const SECURITY_PATH = "/account/security";
/** What a change of someone's own two-step shows up in besides their page. */
const AFFECTED_PATHS = [SECURITY_PATH, "/settings/users", "/settings/users/activity"] as const;

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function fail(reason: TwoStepFailure, message: string): TwoStepActionResult<never> {
  return { status: "error", reason, message };
}

const CONFLICT_REASON = {
  wrongCode: "wrong_code",
  alreadyOn: "already_on",
  notOn: "not_on",
  policyRequired: "policy_required",
  platformRequired: "platform_required",
} as const satisfies Record<string, TwoStepFailure>;

/** A failed write as a reason + the locale's sentence. `onNotFound` is what a 404 means for this call. */
function failureOf(
  result: Exclude<MutationResult<unknown>, { readonly outcome: "ok" }>,
  t: Dictionary,
  onNotFound: "expired" | "generic",
): TwoStepActionResult<never> {
  switch (result.outcome) {
    case "unauthorized":
      // A 401 is either the member's session or, on turning two-step off, a wrong password.
      return result.code === "INVALID_PASSWORD"
        ? fail("wrong_password", t.accountSecurity.errors.wrongPassword)
        : fail("unauthorized", t.formErrors.unauthorized);
    case "forbidden":
      return fail("forbidden", t.formErrors.forbidden);
    case "not_found":
      return onNotFound === "expired"
        ? fail("expired", t.accountSecurity.errors.expired)
        : fail("unexpected", t.formErrors.notFound);
    case "conflict": {
      // Wave 1f: the platform rule is a flat 409 with the code TWO_STEP_REQUIRED; the sentence maps too.
      const key =
        result.code === "TWO_STEP_REQUIRED"
          ? "platformRequired"
          : ownTwoStepConflictKey(result.message);
      return key === null
        ? fail("unexpected", t.formErrors.conflict)
        : fail(CONFLICT_REASON[key], t.accountSecurity.errors[key]);
    }
    case "invalid":
      return fail("validation", t.formErrors.invalid);
    case "error":
      if (result.status === 429) return fail("limited", t.accountSecurity.errors.limited);
      if (result.status === 503 && result.code === "NOT_CONFIGURED") {
        return fail("not_configured", t.accountSecurity.errors.notConfigured);
      }
      return fail("unexpected", t.formErrors.unexpected);
  }
}

function revalidate(paths: readonly string[]): void {
  for (const path of paths) revalidatePath(path);
}

function isCode(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 32;
}

/** Begins a setup: the manual key and the `otpauth://` link come back ONCE, in this return value only. */
export async function startTwoStepAction(): Promise<TwoStepActionResult<TwoStepSetup>> {
  const t = await dictionary();
  const result = await startOwnTwoStep();
  revalidate([SECURITY_PATH]);
  return result.outcome === "ok"
    ? { status: "ok", data: result.data }
    : failureOf(result, t, "generic");
}

/** The first code from the authenticator app; the 10 backup codes come back ONCE. */
export async function confirmTwoStepAction(input: {
  readonly enrollmentId: string;
  readonly code: string;
}): Promise<TwoStepActionResult<{ readonly backupCodes: readonly string[] }>> {
  const t = await dictionary();
  if (!isCode(input?.code)) return fail("validation", t.accountSecurity.errors.codeRequired);
  if (typeof input.enrollmentId !== "string" || input.enrollmentId.length === 0) {
    return fail("validation", t.formErrors.invalid);
  }
  const result = await confirmOwnTwoStep({
    enrollmentId: input.enrollmentId,
    code: input.code.trim(),
  });
  revalidate(AFFECTED_PATHS);
  return result.outcome === "ok"
    ? { status: "ok", data: { backupCodes: result.data.backupCodes } }
    : failureOf(result, t, "expired");
}

/** Replaces the backup codes (needs a current authenticator code); the new ones come back ONCE. */
export async function regenerateBackupCodesAction(input: {
  readonly code: string;
}): Promise<TwoStepActionResult<{ readonly backupCodes: readonly string[] }>> {
  const t = await dictionary();
  if (!isCode(input?.code)) return fail("validation", t.accountSecurity.errors.codeRequired);
  const result = await regenerateBackupCodes(input.code.trim());
  revalidate(AFFECTED_PATHS);
  return result.outcome === "ok"
    ? { status: "ok", data: { backupCodes: result.data.backupCodes } }
    : failureOf(result, t, "generic");
}

/** Turns two-step off after re-checking the password (the server refuses while the store requires it). */
export async function disableTwoStepAction(input: {
  readonly password: string;
}): Promise<TwoStepActionResult<null>> {
  const t = await dictionary();
  const password = input?.password;
  if (typeof password !== "string" || password.length === 0 || password.length > 256) {
    return fail("validation", t.accountSecurity.errors.passwordRequired);
  }
  const result = await disableOwnTwoStep(password);
  revalidate(AFFECTED_PATHS);
  return result.outcome === "ok" ? { status: "ok", data: null } : failureOf(result, t, "generic");
}
