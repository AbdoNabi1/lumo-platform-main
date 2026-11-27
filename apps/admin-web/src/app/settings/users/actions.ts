"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  STAFF_ROLES,
  changeStaffRole,
  inviteStaff,
  resendStaffInvitation,
  resetStaffTwoStep,
  revokeStaffInvitation,
  setRequireTwoStep,
  setStaffActive,
  type StaffRole,
} from "@/lib/api/staff";
import type { MutationResult } from "@/lib/api/client";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { staffConflictMessage } from "@/lib/staff/errors";
import { policyConflict } from "@/lib/staff/two-step";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify parity Wave 1d — the Users and permissions write actions. Same discipline as
 * `app/customers/segments/actions.ts`: one `Idempotency-Key` per invocation, `revalidatePath` after
 * EVERY outcome that reached the API (a stale 409, a 403 or a 502 may all still mean the list on
 * screen is out of date), and the server's answer mapped onto a locale sentence. The server is the
 * authority for every rule: the screen hides actions on the owner and on yourself, but a refusal
 * (403 / 409) is always shown, never assumed away.
 */

/**
 * `code` is set only where the screen must behave differently: `EMAIL_FAILED` (the invitation IS
 * saved, so the dialog closes and the banner offers Resend) and `NOT_CONFIGURED` (nothing was written).
 */
export type StaffActionState =
  | { readonly status: "success" }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, string>>;
      readonly code?: "EMAIL_FAILED" | "NOT_CONFIGURED";
    };

const PAGE_PATH = "/settings/users";
/** Every change here also writes a row the activity page lists (and turning two-step on or off shows on the table). */
const ACTIVITY_PATH = "/settings/users/activity";

function revalidateUsers(): void {
  revalidatePath(PAGE_PATH);
  revalidatePath(ACTIVITY_PATH);
}

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function failure(
  message: string,
  fieldErrors: Readonly<Record<string, string>> = {},
  code?: "EMAIL_FAILED" | "NOT_CONFIGURED",
): StaffActionState {
  return code === undefined
    ? { status: "error", message, fieldErrors }
    : { status: "error", message, fieldErrors, code };
}

function stateOf(result: MutationResult<unknown>, t: Dictionary): StaffActionState {
  switch (result.outcome) {
    case "ok":
      return { status: "success" };
    case "unauthorized":
      return failure(t.formErrors.unauthorized);
    case "forbidden":
      return failure(t.formErrors.forbidden);
    case "not_found":
      return failure(t.formErrors.notFound);
    case "conflict":
      return failure(staffConflictMessage(result.message, t) ?? t.formErrors.conflict);
    case "invalid": {
      // Only the email has a user-facing rule worth naming; the server's own field text is English.
      if (result.fields.some((issue) => issue.field === "email")) {
        return failure(t.users.errors.emailInvalid, { email: t.users.errors.emailInvalid });
      }
      return failure(t.formErrors.invalid);
    }
    case "error":
      if (result.status === 503 && result.code === "NOT_CONFIGURED") {
        return failure(t.users.errors.notConfigured, {}, "NOT_CONFIGURED");
      }
      if (result.status === 502 && result.code === "EMAIL_FAILED") {
        return failure(t.users.errors.emailFailed, {}, "EMAIL_FAILED");
      }
      return failure(t.formErrors.unexpected);
  }
}

function isRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Sends an invitation (`staff:invite`). The 502 case carries `code: "EMAIL_FAILED"`: the invitation is saved. */
export async function inviteStaffAction(input: {
  readonly email: string;
  readonly role: StaffRole;
}): Promise<StaffActionState> {
  const t = await dictionary();
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  if (email.length === 0 || email.length > 320 || !isRole(input?.role)) {
    return failure(
      t.formErrors.invalid,
      email.length === 0 ? { email: t.users.errors.emailInvalid } : {},
    );
  }
  const result = await inviteStaff({ email, role: input.role }, newIdempotencyKey());
  revalidateUsers();
  return stateOf(result, t);
}

/** Sends a pending invitation again with a new link; `expectedVersion` is the version the row loaded. */
export async function resendInvitationAction(
  invitationId: string,
  expectedVersion: number,
): Promise<StaffActionState> {
  const t = await dictionary();
  if (!isId(invitationId) || !isVersion(expectedVersion)) return failure(t.formErrors.invalid);
  const result = await resendStaffInvitation(invitationId, expectedVersion, newIdempotencyKey());
  revalidateUsers();
  return stateOf(result, t);
}

/** Revokes a pending invitation; the link stops working and the email is free again. */
export async function revokeInvitationAction(
  invitationId: string,
  expectedVersion: number,
): Promise<StaffActionState> {
  const t = await dictionary();
  if (!isId(invitationId) || !isVersion(expectedVersion)) return failure(t.formErrors.invalid);
  const result = await revokeStaffInvitation(invitationId, expectedVersion, newIdempotencyKey());
  revalidateUsers();
  return stateOf(result, t);
}

/** Changes a member's role (`staff:change_role`); the server refuses the owner and yourself. */
export async function changeStaffRoleAction(
  principalExternalId: string,
  role: StaffRole,
): Promise<StaffActionState> {
  const t = await dictionary();
  if (!isId(principalExternalId) || !isRole(role)) return failure(t.formErrors.invalid);
  const result = await changeStaffRole(principalExternalId, role, newIdempotencyKey());
  revalidateUsers();
  return stateOf(result, t);
}

/** Deactivates (`false`) or reactivates (`true`) a member; the server refuses the owner and yourself. */
export async function setStaffActiveAction(
  principalExternalId: string,
  active: boolean,
): Promise<StaffActionState> {
  const t = await dictionary();
  if (!isId(principalExternalId) || typeof active !== "boolean")
    return failure(t.formErrors.invalid);
  const result = await setStaffActive(principalExternalId, active, newIdempotencyKey());
  revalidateUsers();
  return stateOf(result, t);
}

/**
 * Wave 1f (D28): an admin resets a colleague's two-step; at their next sign-in they set it up again. The
 * server refuses the owner, yourself and a pending invitee with exact sentences (mapped to the locale).
 * Revalidates the table (their badge flips to Off) and the activity page on every outcome that reached the
 * API.
 */
export async function resetStaffTwoStepAction(
  principalExternalId: string,
): Promise<StaffActionState> {
  const t = await dictionary();
  if (!isId(principalExternalId)) return failure(t.formErrors.invalid);
  const result = await resetStaffTwoStep(principalExternalId, newIdempotencyKey());
  revalidateUsers();
  return stateOf(result, t);
}

/**
 * Requires two-step verification for everyone (or stops requiring it). The server decides whether
 * enabling is allowed and refuses with one of its exact sentences, mapped here; an unknown 409 is the
 * generic "try again", never raw text.
 */
export async function setRequireTwoStepAction(enabled: boolean): Promise<StaffActionState> {
  const t = await dictionary();
  if (typeof enabled !== "boolean") return failure(t.formErrors.invalid);
  const result = await setRequireTwoStep(enabled, newIdempotencyKey());
  revalidateUsers();
  if (result.outcome === "conflict") {
    return failure(
      policyConflict(result.message, t) ??
        staffConflictMessage(result.message, t) ??
        t.formErrors.conflict,
    );
  }
  return stateOf(result, t);
}
