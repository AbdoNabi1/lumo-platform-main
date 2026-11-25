import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";
import {
  STAFF_ROLES,
  STAFF_STATUSES,
  type StaffInvitationView,
  type StaffMemberView,
  type StaffRole,
  type StaffStatus,
} from "@/lib/staff/roles";

// The vocabulary lives in `@/lib/staff/roles` (client-safe); re-exported so server callers keep
// their imports.
export { STAFF_ROLES };
export type { StaffInvitationView, StaffMemberView, StaffRole, StaffStatus };

/**
 * Shopify parity Wave 1d — Settings > Users and permissions. Wire types mirror `apps/admin`'s
 * `/api/v1/staff` routes (Security's `StaffMemberView`; the owner-only guard answers 403 to anyone
 * but an admin). Server-side only, like every client in this folder: call from a Server Component
 * or a Server Action, never from a Client Component.
 *
 * No secret ever travels here: the invitation link exists only in the email body, so none of these
 * shapes carries a token, a hash or a password.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

function isInvitation(value: unknown): value is StaffInvitationView {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["expiresAt"] === "string" &&
    typeof value["version"] === "number" &&
    Number.isSafeInteger(value["version"]) &&
    value["version"] >= 1
  );
}

/** True for exactly the member shape Security produces; anything else is a contract break. */
export function isStaffMemberView(value: unknown): value is StaffMemberView {
  return (
    isRecord(value) &&
    typeof value["principalExternalId"] === "string" &&
    typeof value["email"] === "string" &&
    (value["role"] === "owner" || isStaffRole(value["role"])) &&
    typeof value["status"] === "string" &&
    STAFF_STATUSES.includes(value["status"]) &&
    typeof value["isOwner"] === "boolean" &&
    typeof value["isSelf"] === "boolean" &&
    typeof value["addedAt"] === "string" &&
    isNullableString(value["lastSignInAt"]) &&
    (value["invitation"] === null || isInvitation(value["invitation"]))
  );
}

function isStaffList(value: unknown): value is { readonly items: readonly StaffMemberView[] } {
  return (
    isRecord(value) && Array.isArray(value["items"]) && value["items"].every(isStaffMemberView)
  );
}

function isInvited(
  value: unknown,
): value is { readonly invitationId: string; readonly principalExternalId: string } {
  return (
    isRecord(value) &&
    typeof value["invitationId"] === "string" &&
    typeof value["principalExternalId"] === "string"
  );
}

function isResent(
  value: unknown,
): value is { readonly invitationId: string; readonly version: number } {
  return (
    isRecord(value) &&
    typeof value["invitationId"] === "string" &&
    typeof value["version"] === "number"
  );
}

function isRevoked(value: unknown): value is { readonly invitationId: string } {
  return isRecord(value) && typeof value["invitationId"] === "string";
}

function isRoleChanged(value: unknown): value is { readonly role: StaffRole } {
  return isRecord(value) && isStaffRole(value["role"]);
}

function isActiveChanged(value: unknown): value is { readonly status: "active" | "deactivated" } {
  return isRecord(value) && (value["status"] === "active" || value["status"] === "deactivated");
}

const invitationPath = (invitationId: string): string =>
  `/api/v1/staff/invitations/${encodeURIComponent(invitationId)}`;
const memberPath = (principalExternalId: string): string =>
  `/api/v1/staff/${encodeURIComponent(principalExternalId)}`;

/** `GET /staff` (`staff:read`) — the owner first, then everyone by email; 403 for anyone but an admin. */
export function fetchStaff(): Promise<ApiResult<{ items: readonly StaffMemberView[] }>> {
  return getAdminApi("/api/v1/staff", isStaffList, { reportForbidden: true });
}

/**
 * `POST /staff/invitations` (`staff:invite`, idempotent) — 201 `{ invitationId, principalExternalId }`.
 * 409 (already staff / pending / another store's email), 422 `email`, 502 `EMAIL_FAILED` (the
 * invitation IS saved; use Resend) and 503 `NOT_CONFIGURED` (nothing written) are all possible.
 */
export function inviteStaff(
  body: { readonly email: string; readonly role: StaffRole },
  idempotencyKey: string,
): Promise<MutationResult<{ invitationId: string; principalExternalId: string }>> {
  return mutateAdminApi(
    "/api/v1/staff/invitations",
    { method: "POST", body, idempotencyKey },
    isInvited,
  );
}

/** `POST /staff/invitations/:id/resend` (`staff:invite`, idempotent) — a new link; the old one dies at once. */
export function resendStaffInvitation(
  invitationId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<{ invitationId: string; version: number }>> {
  return mutateAdminApi(
    `${invitationPath(invitationId)}/resend`,
    { method: "POST", body: { expectedVersion }, idempotencyKey },
    isResent,
  );
}

/** `POST /staff/invitations/:id/revoke` (`staff:invite`, idempotent) — the link stops working and the email is free again. */
export function revokeStaffInvitation(
  invitationId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<{ invitationId: string }>> {
  return mutateAdminApi(
    `${invitationPath(invitationId)}/revoke`,
    { method: "POST", body: { expectedVersion }, idempotencyKey },
    isRevoked,
  );
}

/** `POST /staff/:principalExternalId/role` (`staff:change_role`, idempotent) — never the owner's, never your own. */
export function changeStaffRole(
  principalExternalId: string,
  role: StaffRole,
  idempotencyKey: string,
): Promise<MutationResult<{ role: StaffRole }>> {
  return mutateAdminApi(
    `${memberPath(principalExternalId)}/role`,
    { method: "POST", body: { role }, idempotencyKey },
    isRoleChanged,
  );
}

/** `POST /staff/:principalExternalId/active` (`staff:deactivate`, idempotent) — never the owner, never yourself. */
export function setStaffActive(
  principalExternalId: string,
  active: boolean,
  idempotencyKey: string,
): Promise<MutationResult<{ status: "active" | "deactivated" }>> {
  return mutateAdminApi(
    `${memberPath(principalExternalId)}/active`,
    { method: "POST", body: { active }, idempotencyKey },
    isActiveChanged,
  );
}
