import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(1).max(256),
  })
  .strict();

/**
 * Plan 1C: the signed-in staff member changes their own password. Authenticated, gated by
 * `account:update_self` (every staff role holds it). NOT idempotent: replaying a change with a stale
 * current password must fail, not return a cached success.
 */
export function staffAccountRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
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
  ];
}
