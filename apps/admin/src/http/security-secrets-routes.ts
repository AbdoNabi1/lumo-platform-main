import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const credentialIdParams = z.object({ credentialId: z.string().min(1) });
const scheduleCredentialRotationBody = z.object({
  intervalDays: z.number().int().positive(),
  graceSeconds: z.number().int().min(0),
  autoRotate: z.boolean().optional(),
});
const emergencyRevokeCredentialsBody = z.object({
  principalExternalId: z.string().min(1),
  reason: z.string().min(1),
});

/** S1.5.4 — Secrets admin HTTP surface for Security. Pure delegation. */
export function securitySecretsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/security/credentials/:credentialId/rotation-schedule",
      version: 1,
      permission: "security:schedule_credential_rotation",
      idempotent: true,
      summary: "Attach a rotation policy to a credential (interval + grace + auto)",
      schema: { params: credentialIdParams, body: scheduleCredentialRotationBody },
      handle: ({ params, body, context }) =>
        admin.securitySecrets.scheduleCredentialRotation(context.principal, {
          tenantId: context.tenantId,
          credentialId: params.credentialId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/credentials/rotate-due",
      version: 1,
      permission: "security:rotate_due_credentials",
      summary:
        "Rotate every credential whose scheduled rotation is due (scheduler-driven, idempotent)",
      schema: {},
      handle: ({ context }) =>
        admin.securitySecrets.rotateDueCredentials(context.principal, {
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/credentials/emergency-revoke",
      version: 1,
      permission: "security:emergency_revoke_credentials",
      summary: "Revoke every non-terminal credential for a principal at once (breach response)",
      schema: { body: emergencyRevokeCredentialsBody },
      handle: ({ body, context }) =>
        admin.securitySecrets.emergencyRevokeCredentials(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/credentials/:credentialId/lineage",
      version: 1,
      permission: "security:get_credential_lineage",
      summary: "A credential's rotation lineage (the superseded-by chain), oldest to newest",
      schema: { params: credentialIdParams },
      handle: ({ params, context }) =>
        admin.securitySecrets.getCredentialLineage(context.principal, {
          tenantId: context.tenantId,
          credentialId: params.credentialId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/secret-explorer",
      version: 1,
      permission: "security:secret_explorer",
      summary: "Console read model — secret explorer",
      schema: {},
      handle: ({ context }) =>
        admin.securitySecrets.secretExplorer(context.principal, context.tenantId),
    }),
  ] as readonly RouteDefinition[];
}
