import type { Dictionary } from "@/messages/en";

/**
 * Wave 1e — the two-step vocabulary shared by server code and Client Components: the wire shapes,
 * the activity kinds, and the mapping of the server's exact 409 sentences onto the locale's own text.
 * Kept free of every server import (no `next/headers`, nothing from `@/lib/api/*`) so a `"use client"`
 * file may take VALUES from here; `@/lib/api/two-step` and `@/lib/api/staff` use the same types.
 */

/** `GET /auth/staff/two-step`. */
export interface OwnTwoStepStatus {
  readonly enabled: boolean;
  readonly activatedAt: string | null;
  readonly backupCodesLeft: number;
  /** The store requires two-step for everyone: it can't be turned off. */
  readonly policyRequired: boolean;
  /**
   * Wave 1f: Morbeh requires two-step for everyone (staff and merchants), so it can't be turned off.
   * Absent from a server that predates the rule: read it as `=== true`.
   */
  readonly platformRequired?: boolean | undefined;
}

/** `POST /auth/staff/two-step/start` (201). The secret lives only in the client state that holds it. */
export interface TwoStepSetup {
  readonly enrollmentId: string;
  readonly manualKey: string;
  readonly provisioningUri: string;
}

/** `GET /staff/security-policy`. */
export interface StaffSecurityPolicy {
  readonly requireTwoStep: boolean;
  readonly codeStepAvailable: boolean;
  readonly activeStaff: number;
  readonly enrolledActiveStaff: number;
  readonly notEnrolled: readonly { readonly principalExternalId: string; readonly email: string }[];
  readonly pendingInvitations: number;
  /** Wave 1f: Morbeh requires two-step for everyone, so the per-store switch is read-only. Absent = false. */
  readonly platformRequired?: boolean | undefined;
}

export const ACTIVITY_KINDS = [
  "signed_in",
  "sign_in_failed",
  "code_failed",
  "invited",
  "invitation_accepted",
  "invitation_revoked",
  "role_changed",
  "deactivated",
  "reactivated",
  "two_step_on",
  "two_step_off",
  "backup_codes_regenerated",
  "two_step_policy_changed",
  "two_step_reset",
] as const;
export type StaffActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One row of `GET /staff/activity`. */
export interface StaffActivityItem {
  readonly id: string;
  readonly at: string;
  readonly kind: StaffActivityKind;
  readonly actorEmail: string | null;
  readonly subjectEmail: string | null;
  readonly detail: {
    readonly from?: string;
    readonly to?: string;
    readonly enabled?: boolean;
  };
}

/** `GET /staff/activity`. `nextCursor` is opaque: only ever handed back as `?cursor=`. */
export interface StaffActivityPage {
  readonly items: readonly StaffActivityItem[];
  readonly nextCursor: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for exactly the setup shape `POST .../start` answers (the key is shown once). Pure. */
export function isTwoStepSetup(value: unknown): value is TwoStepSetup {
  return (
    isRecord(value) &&
    typeof value["enrollmentId"] === "string" &&
    value["enrollmentId"].length > 0 &&
    typeof value["manualKey"] === "string" &&
    value["manualKey"].length > 0 &&
    typeof value["provisioningUri"] === "string" &&
    value["provisioningUri"].startsWith("otpauth://")
  );
}

/** True for a body carrying the 10 backup codes (`{ backupCodes: string[] }`). Pure. */
export function isBackupCodesBody(
  value: unknown,
): value is { readonly backupCodes: readonly string[] } {
  return (
    isRecord(value) &&
    Array.isArray(value["backupCodes"]) &&
    value["backupCodes"].every((code) => typeof code === "string")
  );
}

/** Group a manual key in blocks of four (`ABCD EFGH …`) so it can be read aloud and typed. */
export function groupManualKey(key: string): string {
  return key.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/** What the writes may answer with a 409, as a key of the locale's own text. */
export type OwnConflictKey =
  "wrongCode" | "alreadyOn" | "notOn" | "policyRequired" | "platformRequired";
type PolicyErrorKey = keyof Dictionary["usersPolicy"]["errors"];

const OWN_CONFLICTS: Readonly<Record<string, OwnConflictKey>> = {
  "That code didn't work. Try again.": "wrongCode",
  "Two-step verification is already on": "alreadyOn",
  "Two-step verification isn't on": "notOn",
  "Your store requires two-step verification, so it can't be turned off": "policyRequired",
  // Wave 1f: the platform rule (409 `TWO_STEP_REQUIRED`, flat).
  "Two-step verification is required for everyone, so it can't be turned off": "platformRequired",
};

/** Which known sentence a 409 from the self-service routes is, or `null` for any other. */
export function ownTwoStepConflictKey(message: string): OwnConflictKey | null {
  return OWN_CONFLICTS[message] ?? null;
}

const POLICY_CONFLICTS: Readonly<Record<string, PolicyErrorKey>> = {
  "Two-step sign-in isn't available on this server yet": "unavailable",
  "Turn on two-step verification for your own account first": "selfFirst",
  "Everyone needs two-step verification turned on first": "everyoneFirst",
  "Revoke or wait for pending invitations first": "pendingInvitations",
  // Wave 1f: the platform rule (409 `TWO_STEP_REQUIRED`, flat).
  "Two-step verification is required for everyone on Morbeh": "platformRequired",
};

/**
 * The locale's text for a 409 from the policy switch, or `null` for any other sentence (the caller
 * then shows the generic "try again"; nothing the server says is ever shown raw).
 */
export function policyConflict(message: string, t: Dictionary): string | null {
  const key = POLICY_CONFLICTS[message];
  return key === undefined ? null : t.usersPolicy.errors[key];
}

/** The 1d staff commands refuse while the store requires two-step; their English sentence starts like this. */
export const REQUIRES_TWO_STEP_PREFIX =
  "Your store requires two-step verification. Turn that off before";

/** The locale's text for the "requires two-step" refusals of inviting and reactivating, else `null`. */
export function requiresTwoStepConflict(message: string, t: Dictionary): string | null {
  if (message === `${REQUIRES_TWO_STEP_PREFIX} inviting people`) {
    return t.users.errors.requiresTwoStepInvite;
  }
  if (message === `${REQUIRES_TWO_STEP_PREFIX} reactivating people`) {
    return t.users.errors.requiresTwoStepReactivate;
  }
  return null;
}
