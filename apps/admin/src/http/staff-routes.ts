import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const roleSchema = z.enum(["admin", "operator", "viewer"]);
const invitationParams = z.object({ invitationId: z.string().min(1).max(100) });
const memberParams = z.object({ principalExternalId: z.string().min(1).max(100) });

// Transport schemas check STRUCTURE only. Security is the authority for every semantic rule (email shape,
// owner/self/last-admin protection, stale versions) and answers 422 / 404 / 409 with the user-facing text.
const inviteBody = z.object({ email: z.string().max(320), role: roleSchema }).strict();
const versionBody = z.object({ expectedVersion: z.number().int().min(1) }).strict();
const roleBody = z.object({ role: roleSchema }).strict();
const activeBody = z.object({ active: z.boolean() }).strict();

/**
 * Wave 1d — Settings > Users and permissions. Spread next to `customerSegmentRoutes` in `admin-routes.ts`.
 * `/staff/invitations/...` is registered BEFORE `/staff/:principalExternalId/...` so the parameter never
 * swallows it. The tenant comes from the verified context and the acting member from `context.principal.id`
 * (an externalId). Every write is `POST` + `idempotent`. The public accept routes live with the sign-in routes.
 */
export function staffRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/staff",
      version: 1,
      permission: "staff:read",
      summary:
        "List the store's staff: owner first, then by email (invited and deactivated included)",
      schema: {},
      handle: ({ context }) => admin.staff.list(context.principal, context.tenantId),
    }),
    defineRoute({
      method: "POST",
      path: "/staff/invitations",
      version: 1,
      permission: "staff:invite",
      idempotent: true,
      summary: "Invite someone to the staff by email with a fixed role (7-day single-use link)",
      schema: { body: inviteBody },
      handle: ({ body, context }) =>
        admin.staff.invite(context.principal, context.tenantId, {
          email: body.email,
          role: body.role,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/staff/invitations/:invitationId/resend",
      version: 1,
      permission: "staff:invite",
      idempotent: true,
      summary: "Resend an invitation with a new link (the old link stops working at once)",
      schema: { params: invitationParams, body: versionBody },
      handle: ({ params, body, context }) =>
        admin.staff.resend(
          context.principal,
          context.tenantId,
          params.invitationId,
          body.expectedVersion,
        ),
    }),
    defineRoute({
      method: "POST",
      path: "/staff/invitations/:invitationId/revoke",
      version: 1,
      permission: "staff:invite",
      idempotent: true,
      summary: "Revoke an invitation; the link stops working and the email is free again",
      schema: { params: invitationParams, body: versionBody },
      handle: ({ params, body, context }) =>
        admin.staff.revoke(
          context.principal,
          context.tenantId,
          params.invitationId,
          body.expectedVersion,
        ),
    }),
    defineRoute({
      method: "POST",
      path: "/staff/:principalExternalId/role",
      version: 1,
      permission: "staff:change_role",
      idempotent: true,
      summary: "Change a staff member's role (never the owner's, never your own)",
      schema: { params: memberParams, body: roleBody },
      handle: ({ params, body, context }) =>
        admin.staff.changeRole(
          context.principal,
          context.tenantId,
          params.principalExternalId,
          body.role,
        ),
    }),
    defineRoute({
      method: "POST",
      path: "/staff/:principalExternalId/active",
      version: 1,
      permission: "staff:deactivate",
      idempotent: true,
      summary: "Deactivate or reactivate a staff member (never the owner, never yourself)",
      schema: { params: memberParams, body: activeBody },
      handle: ({ params, body, context }) =>
        admin.staff.setActive(
          context.principal,
          context.tenantId,
          params.principalExternalId,
          body.active,
        ),
    }),
  ];
}
