import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";
import {
  STAFF_ROLES,
  STAFF_STATUSES,
  type StaffInvitationView,
  type StaffMemberView,
  type StaffRole,
  type StaffStatus,
} from "@/lib/staff/roles";
import {
  ACTIVITY_KINDS,
  type StaffActivityItem,
  type StaffActivityPage,
  type StaffSecurityPolicy,
} from "@/lib/staff/two-step";

// The vocabulary lives in `@/lib/staff/roles` (client-safe); re-exported so server callers keep
// their imports.
export { STAFF_ROLES };
export type { StaffInvitationView, StaffMemberView, StaffRole, StaffStatus };
export type { StaffActivityItem, StaffActivityPage, StaffSecurityPolicy };

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
    typeof value["twoStep"] === "boolean" &&
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

function isReset(value: unknown): value is { readonly reset: true } {
  return isRecord(value) && value["reset"] === true;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** True for exactly the policy shape `GET /staff/security-policy` produces. */
export function isStaffSecurityPolicy(value: unknown): value is StaffSecurityPolicy {
  return (
    isRecord(value) &&
    typeof value["requireTwoStep"] === "boolean" &&
    typeof value["codeStepAvailable"] === "boolean" &&
    isCount(value["activeStaff"]) &&
    isCount(value["enrolledActiveStaff"]) &&
    Array.isArray(value["notEnrolled"]) &&
    value["notEnrolled"].every(
      (entry) =>
        isRecord(entry) &&
        typeof entry["principalExternalId"] === "string" &&
        typeof entry["email"] === "string",
    ) &&
    isCount(value["pendingInvitations"]) &&
    (value["platformRequired"] === undefined || typeof value["platformRequired"] === "boolean")
  );
}

function isActivityDetail(value: unknown): value is StaffActivityItem["detail"] {
  return (
    isRecord(value) &&
    (value["from"] === undefined || typeof value["from"] === "string") &&
    (value["to"] === undefined || typeof value["to"] === "string") &&
    (value["enabled"] === undefined || typeof value["enabled"] === "boolean")
  );
}

function isActivityItem(value: unknown): value is StaffActivityItem {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["at"] === "string" &&
    typeof value["kind"] === "string" &&
    (ACTIVITY_KINDS as readonly string[]).includes(value["kind"]) &&
    isNullableString(value["actorEmail"]) &&
    isNullableString(value["subjectEmail"]) &&
    isActivityDetail(value["detail"])
  );
}

function isActivityPage(value: unknown): value is StaffActivityPage {
  return (
    isRecord(value) &&
    Array.isArray(value["items"]) &&
    value["items"].every(isActivityItem) &&
    isNullableString(value["nextCursor"])
  );
}

function isPolicyChanged(value: unknown): value is { readonly requireTwoStep: boolean } {
  return isRecord(value) && typeof value["requireTwoStep"] === "boolean";
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

/**
 * `POST /staff/:principalExternalId/two-step/reset` (`staff:reset_two_step`, idempotent, admin only) —
 * their next sign-in sets two-step up again. 409 for the owner, for yourself and for a pending invitee.
 */
export function resetStaffTwoStep(
  principalExternalId: string,
  idempotencyKey: string,
): Promise<MutationResult<{ reset: true }>> {
  return mutateAdminApi(
    `${memberPath(principalExternalId)}/two-step/reset`,
    { method: "POST", body: {}, idempotencyKey },
    isReset,
  );
}

/** `GET /staff/security-policy` (`staff:read_policy`, admin) — the policy, whether it can be turned on, and who still has no two-step. */
export function fetchStaffSecurityPolicy(): Promise<ApiResult<StaffSecurityPolicy>> {
  return getAdminApi("/api/v1/staff/security-policy", isStaffSecurityPolicy, {
    reportForbidden: true,
  });
}

/**
 * `POST /staff/security-policy` (`staff:set_policy`, idempotent) — require two-step for everyone, or stop.
 * 409 with one of Security's exact sentences when enabling is refused (mapped in `@/lib/staff/two-step`).
 */
export function setRequireTwoStep(
  requireTwoStep: boolean,
  idempotencyKey: string,
): Promise<MutationResult<{ requireTwoStep: boolean }>> {
  return mutateAdminApi(
    "/api/v1/staff/security-policy",
    { method: "POST", body: { requireTwoStep }, idempotencyKey },
    isPolicyChanged,
  );
}

/**
 * `GET /staff/activity` (`staff:read_activity`, admin) — newest first, `limit` 1..50 (server default 25).
 * `cursor` is the previous page's opaque `nextCursor`; `member` filters to one person (principalExternalId).
 */
export function fetchStaffActivity(
  query: {
    readonly member?: string;
    readonly cursor?: string;
    readonly limit?: number;
  } = {},
): Promise<ApiResult<StaffActivityPage>> {
  const params = new URLSearchParams();
  if (query.member !== undefined && query.member.length > 0) params.set("member", query.member);
  if (query.cursor !== undefined && query.cursor.length > 0) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return getAdminApi(`/api/v1/staff/activity${suffix}`, isActivityPage, { reportForbidden: true });
}
