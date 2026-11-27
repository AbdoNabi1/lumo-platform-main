import { z } from "zod";
import type { RateLimiter } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { rateLimited } from "./rate-limited-response";

const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
  })
  .strict();

const startBody = z.object({}).strict();
const confirmBody = z
  .object({ enrollmentId: z.string().uuid(), code: z.string().min(1).max(32) })
  .strict();
const backupCodesBody = z.object({ code: z.string().min(1).max(32) }).strict();
const disableBody = z.object({ password: z.string().min(1).max(256) }).strict();

/** Six tries per member in ten minutes across confirm AND new-backup-codes (one shared bucket). */
const CODE_PROOF_LIMIT = 6;
const CODE_PROOF_WINDOW_MS = 10 * 60 * 1000;

/**
 * Plan 1C: the signed-in staff member changes their own password. Authenticated, gated by
 * `account:update_self` (every staff role holds it). NOT idempotent: replaying a change with a stale
 * current password must fail, not return a cached success.
 *
 * Wave 1e adds the member's own two-step verification under `/auth/staff/two-step`, same permission
 * (everyone may protect their own account; none of these is owner-only). The member is ALWAYS
 * `context.principal.id` and the tenant `context.tenantId`: no body or path field names a person. None
 * is idempotent — a secret or a set of backup codes must never sit in the idempotency cache — and the
 * ones that return them (start, confirm, backup-codes) set `cache-control: private, no-store`.
 * `rateLimiter` is optional (tests); the real wiring always passes it.
 */
export function staffAccountRoutes(
  admin: WiredAdmin,
  rateLimiter?: RateLimiter,
): readonly RouteDefinition[] {
  /** Spends one try of the member's code-proof bucket; the 429 when it is gone (or the limiter is down). */
  const codeProofLimit = async (tenantId: string, principalId: string) => {
    if (rateLimiter === undefined) return null;
    try {
      const decision = await rateLimiter.consume(
        `rl:${tenantId}:staff-mfa-confirm:${principalId}`,
        CODE_PROOF_LIMIT,
        CODE_PROOF_WINDOW_MS,
      );
      return decision.allowed
        ? null
        : rateLimited(decision.retryAfterMs, "Too many attempts. Wait a few minutes.");
    } catch {
      return rateLimited(60_000, "Too many attempts. Wait a few minutes.");
    }
  };

  return [
    defineRoute({
      method: "POST",
      path: "/auth/staff/password",
      version: 1,
      permission: "account:update_self",
      summary: "Change the signed-in staff member's own password",
      schema: { body: changePasswordBody },
      handle: ({ body, context }) =>
        admin.staffAuth.changePassword({
          tenantId: context.tenantId,
          principalExternalId: context.principal.id,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/auth/staff/two-step",
      version: 1,
      permission: "account:update_self",
      summary:
        "Whether the signed-in member has two-step verification on, and whether the store requires it",
      schema: {},
      handle: ({ context }) =>
        admin.staffAuth.twoStepStatus(context.tenantId, context.principal.id),
    }),
    defineRoute({
      method: "POST",
      path: "/auth/staff/two-step/start",
      version: 1,
      permission: "account:update_self",
      summary: "Start setting up two-step verification (returns the secret ONCE; never cached)",
      schema: { body: startBody },
      handle: ({ context }) => admin.staffAuth.startTwoStep(context.tenantId, context.principal.id),
    }),
    defineRoute({
      method: "POST",
      path: "/auth/staff/two-step/confirm",
      version: 1,
      permission: "account:update_self",
      summary: "Confirm the setup with the first code; returns the 10 backup codes ONCE",
      schema: { body: confirmBody },
      handle: async ({ body, context }) => {
        const limited = await codeProofLimit(context.tenantId, context.principal.id);
        if (limited !== null) return limited;
        return admin.staffAuth.confirmTwoStep({
          tenantId: context.tenantId,
          principalExternalId: context.principal.id,
          enrollmentId: body.enrollmentId,
          code: body.code,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/auth/staff/two-step/backup-codes",
      version: 1,
      permission: "account:update_self",
      summary: "Replace the backup codes (needs a current authenticator code); returns them ONCE",
      schema: { body: backupCodesBody },
      handle: async ({ body, context }) => {
        const limited = await codeProofLimit(context.tenantId, context.principal.id);
        if (limited !== null) return limited;
        return admin.staffAuth.regenerateBackupCodes({
          tenantId: context.tenantId,
          principalExternalId: context.principal.id,
          code: body.code,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/auth/staff/two-step/disable",
      version: 1,
      permission: "account:update_self",
      summary: "Turn two-step verification off (needs the account password; refused when required)",
      schema: { body: disableBody },
      handle: ({ body, context }) =>
        admin.staffAuth.disableTwoStep({
          tenantId: context.tenantId,
          principalExternalId: context.principal.id,
          password: body.password,
        }),
    }),
  ];
}
