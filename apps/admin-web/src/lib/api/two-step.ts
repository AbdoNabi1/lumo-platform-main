import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";
import {
  isBackupCodesBody,
  isTwoStepSetup,
  type OwnTwoStepStatus,
  type TwoStepSetup,
} from "@/lib/staff/two-step";

export type { OwnTwoStepStatus, TwoStepSetup };

/**
 * Wave 1e — the signed-in member's own two-step verification (`/auth/staff/two-step*`,
 * `account:update_self`, every role). Server-side only, like every client in this folder: call from
 * a Server Component or a Server Action, never from a Client Component.
 *
 * Every write is sent WITHOUT an `Idempotency-Key`: the routes are not idempotent on purpose (a TOTP
 * secret or a set of backup codes must never sit in an idempotency cache, and replaying a stale code
 * must fail, not return a cached success). Nothing here logs a secret, a code or a password.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is OwnTwoStepStatus {
  return (
    isRecord(value) &&
    typeof value["enabled"] === "boolean" &&
    (value["activatedAt"] === null || typeof value["activatedAt"] === "string") &&
    typeof value["backupCodesLeft"] === "number" &&
    Number.isSafeInteger(value["backupCodesLeft"]) &&
    typeof value["policyRequired"] === "boolean" &&
    (value["platformRequired"] === undefined || typeof value["platformRequired"] === "boolean")
  );
}

/** The disable route answers a plain acknowledgement; its body carries nothing the screen reads. */
function isAnything(_value: unknown): _value is unknown {
  return true;
}

/** `GET /auth/staff/two-step` — whether two-step is on, since when, codes left, and whether the store requires it. */
export function fetchOwnTwoStep(): Promise<ApiResult<OwnTwoStepStatus>> {
  return getAdminApi("/api/v1/auth/staff/two-step", isStatus);
}

/**
 * `POST /auth/staff/two-step/start` — 201 with the manual key and the `otpauth://` link, ONCE.
 * 409 already on · 503 `NOT_CONFIGURED` (this server has no TOTP key).
 */
export function startOwnTwoStep(): Promise<MutationResult<TwoStepSetup>> {
  return mutateAdminApi(
    "/api/v1/auth/staff/two-step/start",
    { method: "POST", body: {} },
    isTwoStepSetup,
  );
}

/** `POST /auth/staff/two-step/confirm` — the first code; the 10 backup codes come back ONCE. 409 wrong code · 429. */
export function confirmOwnTwoStep(body: {
  readonly enrollmentId: string;
  readonly code: string;
}): Promise<MutationResult<{ readonly backupCodes: readonly string[] }>> {
  return mutateAdminApi(
    "/api/v1/auth/staff/two-step/confirm",
    { method: "POST", body },
    isBackupCodesBody,
  );
}

/** `POST /auth/staff/two-step/backup-codes` — replaces the backup codes (needs a current code), ONCE. 409 · 429. */
export function regenerateBackupCodes(
  code: string,
): Promise<MutationResult<{ readonly backupCodes: readonly string[] }>> {
  return mutateAdminApi(
    "/api/v1/auth/staff/two-step/backup-codes",
    { method: "POST", body: { code } },
    isBackupCodesBody,
  );
}

/**
 * `POST /auth/staff/two-step/disable` — needs the account password. A wrong password is a 401
 * `INVALID_PASSWORD` (reported as `unauthorized` with that `code`); the store requiring two-step is a 409.
 */
export function disableOwnTwoStep(password: string): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/auth/staff/two-step/disable",
    { method: "POST", body: { password }, readCodeOn401: true },
    isAnything,
  );
}
