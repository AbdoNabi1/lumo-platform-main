/**
 * The staff vocabulary — roles, statuses and the member view shapes — kept free of every server
 * import so a `"use client"` component can take VALUES (`STAFF_ROLES`) from here. `@/lib/api/staff`
 * imports the server-only API client (`next/headers`); a value import of it from a Client
 * Component fails `next build`. `@/lib/api/staff` re-exports all of this, so server code is unchanged.
 */

export type StaffRole = "admin" | "operator" | "viewer";
export const STAFF_ROLES: readonly StaffRole[] = ["admin", "operator", "viewer"];
export type StaffStatus = "active" | "invited" | "invitation_expired" | "deactivated";

export const STAFF_STATUSES: readonly string[] = [
  "active",
  "invited",
  "invitation_expired",
  "deactivated",
];

export interface StaffInvitationView {
  readonly id: string;
  readonly expiresAt: string;
  readonly version: number;
}

export interface StaffMemberView {
  readonly principalExternalId: string;
  /** The sign-in email (the credential identifier without its `staff:` prefix). */
  readonly email: string;
  /** `owner` = holds the store-owner role, which wins over any other. */
  readonly role: StaffRole | "owner";
  readonly status: StaffStatus;
  readonly isOwner: boolean;
  /** True for the signed-in member's own row. */
  readonly isSelf: boolean;
  readonly addedAt: string;
  readonly lastSignInAt: string | null;
  /** A pending (or expired-pending) invitation; `null` once accepted, revoked or never sent. */
  readonly invitation: StaffInvitationView | null;
}
