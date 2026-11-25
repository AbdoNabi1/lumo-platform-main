/**
 * Wave 1d shared vocabulary for "Users and permissions" (staff). Produced here, consumed by the admin
 * controller and the admin UI. The fixed staff roles are Security role keys held through role
 * assignments; the owner is whoever holds `platform-admin`.
 */
export type StaffRole = "admin" | "operator" | "viewer";
export const STAFF_ROLES: readonly StaffRole[] = ["admin", "operator", "viewer"];
/** The Security role key of the store owner. Never assignable, changeable or removable through staff screens. */
export const OWNER_ROLE_KEY = "platform-admin";
export type StaffStatus = "active" | "invited" | "invitation_expired" | "deactivated";

export interface StaffMemberView {
  readonly principalExternalId: string;
  /** Credential identifier without the "staff:" prefix. */
  readonly email: string;
  /** "owner" = holds platform-admin (wins over any other key). */
  readonly role: StaffRole | "owner";
  readonly status: StaffStatus;
  readonly isOwner: boolean;
  /** principalExternalId === actor. */
  readonly isSelf: boolean;
  /** Principal createdAt, ISO. */
  readonly addedAt: string;
  /** max(security.sessions.established_at) for the principal, ISO. */
  readonly lastSignInAt: string | null;
  /** Pending (including expired) invitation only. */
  readonly invitation: {
    readonly id: string;
    readonly expiresAt: string;
    readonly version: number;
  } | null;
}
