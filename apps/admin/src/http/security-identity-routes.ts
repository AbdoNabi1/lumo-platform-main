import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const principalKindEnum = z.enum([
  "human",
  "service_account",
  "machine",
  "api_key",
  "robot",
  "partner",
  "marketplace",
  "ai",
]);
const credentialKindEnum = z.enum([
  "api_key",
  "secret",
  "certificate",
  "signing_key",
  "oauth_client",
]);

const registerPrincipalBody = z.object({
  externalId: z.string().min(1),
  kind: principalKindEnum,
  displayName: z.string().min(1),
  subjectRef: z.string().min(1).nullable().optional(),
  tenantRef: z.string().min(1).nullable().optional(),
  attributes: z.record(z.string()).optional(),
});
const principalExternalIdParams = z.object({ externalId: z.string().min(1) });
const transitionPrincipalBody = z.object({
  to: z.enum(["suspended", "active", "disabled"]),
});

const issueCredentialBody = z.object({
  principalExternalId: z.string().min(1),
  kind: credentialKindEnum,
  material: z.string().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
});
const credentialIdParams = z.object({ credentialId: z.string().min(1) });
const rotateCredentialBody = z.object({ newMaterial: z.string().min(1) });

const machineIdentityConfigSchema = z.object({
  owner: z.string().optional(),
  purpose: z.string().optional(),
  allowedEnvironments: z.array(z.string()).optional(),
  maxCredentialTtlSeconds: z.number().int().positive().nullable().optional(),
  rotationIntervalDays: z.number().int().positive().nullable().optional(),
  allowedScopes: z.array(z.string()).optional(),
});
const governMachineIdentityBody = z.object({ config: machineIdentityConfigSchema });

const subjectRefParams = z.object({ subjectRef: z.string().min(1) });
const userIdParams = z.object({ userId: z.string().min(1) });
const organizationIdParams = z.object({ organizationId: z.string().min(1) });

/** S1.5.1 — Identity & Credentials admin HTTP surface for Security. Pure delegation. */
export function securityIdentityRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/security/principals",
      version: 1,
      permission: "security:register_principal",
      idempotent: true,
      summary: "Register a principal (idempotent per externalId)",
      schema: { body: registerPrincipalBody },
      handle: ({ body, context }) =>
        admin.securityIdentity.registerPrincipal(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/principals/:externalId/transitions",
      version: 1,
      permission: "security:transition_principal",
      idempotent: true,
      summary: "Advance a principal's lifecycle (suspend/activate/disable)",
      schema: { params: principalExternalIdParams, body: transitionPrincipalBody },
      handle: ({ params, body, context }) =>
        admin.securityIdentity.transitionPrincipal(context.principal, {
          externalId: params.externalId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/credentials",
      version: 1,
      permission: "security:issue_credential",
      idempotent: true,
      summary: "Issue a credential for a principal",
      schema: { body: issueCredentialBody },
      handle: ({ body, context }) =>
        admin.securityIdentity.issueCredential(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/credentials/:credentialId/rotate",
      version: 1,
      permission: "security:rotate_credential",
      idempotent: true,
      summary: "Rotate a credential (marks current rotated, issues a superseding one)",
      schema: { params: credentialIdParams, body: rotateCredentialBody },
      handle: ({ params, body, context }) =>
        admin.securityIdentity.rotateCredential(context.principal, {
          credentialId: params.credentialId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/credentials/:credentialId/revoke",
      version: 1,
      permission: "security:revoke_credential",
      idempotent: true,
      summary: "Revoke a credential immediately",
      schema: { params: credentialIdParams },
      handle: ({ params, context }) =>
        admin.securityIdentity.revokeCredential(context.principal, {
          credentialId: params.credentialId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/machine-identities/:externalId",
      version: 1,
      permission: "security:govern_machine_identity",
      idempotent: true,
      summary: "Govern a non-human principal's identity profile (idempotent create-or-patch)",
      schema: { params: principalExternalIdParams, body: governMachineIdentityBody },
      handle: ({ params, body, context }) =>
        admin.securityIdentity.governMachineIdentity(context.principal, {
          principalExternalId: params.externalId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/machine-identities/:externalId/suspend",
      version: 1,
      permission: "security:suspend_machine_identity",
      idempotent: true,
      summary: "Suspend a machine identity (kill-switch)",
      schema: { params: principalExternalIdParams },
      handle: ({ params, context }) =>
        admin.securityIdentity.suspendMachineIdentity(context.principal, {
          principalExternalId: params.externalId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/resolve/principals/:subjectRef",
      version: 1,
      permission: "security:resolve_principal",
      summary:
        "Resolve an Identity subject to the Security principal + projected user + memberships",
      schema: { params: subjectRefParams },
      handle: ({ params, context }) =>
        admin.securityIdentity.resolvePrincipal(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/security/resolve/memberships/:userId",
      version: 1,
      permission: "security:resolve_membership",
      summary: "Resolve the organizations/roles a user belongs to",
      schema: { params: userIdParams },
      handle: ({ params, context }) =>
        admin.securityIdentity.resolveMembership(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/security/resolve/organizations/:organizationId",
      version: 1,
      permission: "security:resolve_organization",
      summary: "Resolve an organization from the Identity projection",
      schema: { params: organizationIdParams },
      handle: ({ params, context }) =>
        admin.securityIdentity.resolveOrganization(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/security/resolve/machine-identities/:externalId",
      version: 1,
      permission: "security:resolve_machine_identity",
      summary: "Resolve a machine identity's governance profile",
      schema: { params: principalExternalIdParams },
      handle: ({ params, context }) =>
        admin.securityIdentity.resolveMachineIdentity(context.principal, {
          principalExternalId: params.externalId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/identity-overview",
      version: 1,
      permission: "security:identity_overview",
      summary: "Console read model — identity overview",
      schema: {},
      handle: ({ context }) => admin.securityIdentity.identityOverview(context.principal),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/machine-identity-explorer",
      version: 1,
      permission: "security:machine_identity_explorer",
      summary: "Console read model — machine-identity explorer",
      schema: {},
      handle: ({ context }) => admin.securityIdentity.machineIdentityExplorer(context.principal),
    }),
  ] as readonly RouteDefinition[];
}
