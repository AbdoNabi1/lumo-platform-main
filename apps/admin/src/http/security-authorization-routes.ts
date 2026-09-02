import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import type { AbacCondition, PolicyExpression, PolicyRule } from "@platform/security";

const securityScopeSchema = z.object({
  organization: z.string().optional(),
  tenant: z.string().optional(),
  workspace: z.string().optional(),
  environment: z.string().optional(),
});
const policyModeEnum = z.enum(["strict", "balanced", "relaxed", "custom"]);
const policyEffectEnum = z.enum(["allow", "challenge", "block", "review"]);
const isolationTierEnum = z.enum(["pooled", "dedicated_schema", "dedicated_db"]);

// PolicyCondition/PolicyExpression are recursive expression-language types (policy-condition.ts /
// policy-expression.ts) — accepted as `unknown` here (validated by the domain layer itself, same
// convention as Automation's open-ended `params`), then reshaped into fresh literals in `handle`
// so each required field stays required after zod's `unknown`-implies-optional inference (the
// lesson from Reporting/M7 applied proactively).
const policyRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  when: z.unknown(),
  expr: z.unknown().optional(),
  effect: policyEffectEnum,
});

const roleKeyParams = z.object({ roleKey: z.string().min(1) });
const defineRoleBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  scope: securityScopeSchema.optional(),
  permissions: z.array(z.string().min(1)).optional(),
  parentKey: z.string().min(1).nullable().optional(),
  isTemplate: z.boolean().optional(),
});
const grantRolePermissionBody = z.object({ permission: z.string().min(1) });
const assignRoleBody = z.object({
  principalExternalId: z.string().min(1),
  roleKey: z.string().min(1),
  grantedBy: z.string().min(1),
  scope: securityScopeSchema.optional(),
  ttlSeconds: z.number().int().positive().optional(),
  reason: z.string().optional(),
});
const assignmentIdParams = z.object({ assignmentId: z.string().min(1) });

const policyKeyParams = z.object({ policyKey: z.string().min(1) });
const definePolicyBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  mode: policyModeEnum,
});
const publishPolicyVersionBody = z.object({
  rules: z.array(policyRuleSchema),
  defaultEffect: policyEffectEnum.optional(),
});
const simulatePolicyBody = z.object({
  context: z.object({
    principalActive: z.boolean().optional(),
    sessionValid: z.boolean().optional(),
    permissionGranted: z.boolean().optional(),
    deviceTrusted: z.boolean().optional(),
    risk: z.number().optional(),
    trust: z.number().optional(),
    environment: z.string().nullable().optional(),
    resource: z.string().nullable().optional(),
  }),
});

const relationTupleBody = z.object({
  namespace: z.string().min(1),
  object: z.string().min(1),
  relation: z.string().min(1),
  subject: z.string().min(1),
});
const checkAccessBody = z.object({
  principalExternalId: z.string().min(1),
  permission: z.string().min(1),
  scope: securityScopeSchema.optional(),
  namespace: z.string().optional(),
  object: z.string().optional(),
  relation: z.string().optional(),
  abac: z.unknown().optional(),
  resourceAttributes: z.record(z.string()).optional(),
  environmentAttributes: z.record(z.string()).optional(),
});
const riskSignalsSchema = z.object({
  failedAuthCount: z.number().optional(),
  newDevice: z.boolean().optional(),
  impossibleTravel: z.boolean().optional(),
  threatIntelHit: z.boolean().optional(),
  ipReputation: z.number().optional(),
});
const trustSignalsSchema = z.object({
  deviceTrusted: z.boolean().optional(),
  mfaSatisfied: z.boolean().optional(),
  sessionAgeDays: z.number().optional(),
  knownGoodPrincipal: z.boolean().optional(),
});
const evaluateAccessBody = z.object({
  principalExternalId: z.string().min(1),
  permission: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  resource: z.string().optional(),
  scope: securityScopeSchema.optional(),
  environment: z.string().optional(),
  deviceRef: z.string().optional(),
  policyKey: z.string().optional(),
  risk: riskSignalsSchema.optional(),
  trust: trustSignalsSchema.optional(),
});

const registerPolicyFragmentBody = z.object({
  key: z.string().min(1),
  description: z.string().optional(),
  expression: z.unknown(),
});
const registerPermissionBody = z.object({
  permission: z.string().min(1),
  description: z.string().min(1),
});

const grantDelegationBody = z.object({
  delegatorExternalId: z.string().min(1),
  delegateExternalId: z.string().min(1),
  scope: securityScopeSchema.optional(),
  permissions: z.array(z.string().min(1)).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  reason: z.string().optional(),
});
const delegationIdParams = z.object({ delegationId: z.string().min(1) });
const startImpersonationBody = z.object({
  refreshFingerprint: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
});

const checkConsentQuery = z.object({ purpose: z.string().min(1) });
const subjectRefParams = z.object({ subjectRef: z.string().min(1) });

const tenantRefParams = z.object({ tenantRef: z.string().min(1) });
const configureTenantSecurityBody = z.object({
  isolationTier: isolationTierEnum.optional(),
  residencyRegion: z.string().optional(),
  securityMode: policyModeEnum.optional(),
  mfaRequired: z.boolean().optional(),
  allowedAuthMethods: z.array(z.string()).optional(),
  defaultPolicyKey: z.string().nullable().optional(),
});

/** S1.5.3 — Authorization admin HTTP surface for Security. Pure delegation. */
export function securityAuthorizationRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/security/roles",
      version: 1,
      permission: "security:define_role",
      idempotent: true,
      summary: "Define a role in the registry (idempotent per key)",
      schema: { body: defineRoleBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.defineRole(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/roles/:roleKey/permissions",
      version: 1,
      permission: "security:grant_role_permission",
      idempotent: true,
      summary: "Add a permission to a role",
      schema: { params: roleKeyParams, body: grantRolePermissionBody },
      handle: ({ params, body, context }) =>
        admin.securityAuthorization.grantRolePermission(context.principal, {
          roleKey: params.roleKey,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/role-assignments",
      version: 1,
      permission: "security:assign_role",
      idempotent: true,
      summary: "Assign a role to a principal (delegated admin via grantedBy, optional TTL)",
      schema: { body: assignRoleBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.assignRole(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/role-assignments/:assignmentId/revoke",
      version: 1,
      permission: "security:revoke_role_assignment",
      idempotent: true,
      summary: "Revoke a role assignment",
      schema: { params: assignmentIdParams },
      handle: ({ params, context }) =>
        admin.securityAuthorization.revokeRoleAssignment(context.principal, {
          assignmentId: params.assignmentId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/policies",
      version: 1,
      permission: "security:define_policy",
      idempotent: true,
      summary: "Define a policy in the Policy Registry (idempotent per key; starts draft)",
      schema: { body: definePolicyBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.definePolicy(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/policies/:policyKey/versions",
      version: 1,
      permission: "security:publish_policy_version",
      idempotent: true,
      summary: "Publish a new immutable policy version and activate it",
      schema: { params: policyKeyParams, body: publishPolicyVersionBody },
      handle: ({ params, body, context }) =>
        admin.securityAuthorization.publishPolicyVersion(context.principal, {
          key: params.policyKey,
          rules: body.rules as readonly PolicyRule[],
          ...(body.defaultEffect !== undefined ? { defaultEffect: body.defaultEffect } : {}),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/policies/:policyKey/archive",
      version: 1,
      permission: "security:archive_policy",
      idempotent: true,
      summary: "Archive a policy",
      schema: { params: policyKeyParams },
      handle: ({ params, context }) =>
        admin.securityAuthorization.archivePolicy(context.principal, { key: params.policyKey }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/policies/:policyKey/simulate",
      version: 1,
      permission: "security:simulate_policy",
      summary: "Simulate a policy's active version against a hypothetical context (read-only)",
      schema: { params: policyKeyParams, body: simulatePolicyBody },
      handle: ({ params, body, context }) =>
        admin.securityAuthorization.simulatePolicy(context.principal, {
          key: params.policyKey,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/relations",
      version: 1,
      permission: "security:write_relation_tuple",
      idempotent: true,
      summary: "Write a ReBAC relation tuple (idempotent by key)",
      schema: { body: relationTupleBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.writeRelationTuple(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/relations/delete",
      version: 1,
      permission: "security:delete_relation_tuple",
      idempotent: true,
      summary: "Remove a ReBAC relation tuple by its components",
      schema: { body: relationTupleBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.deleteRelationTuple(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/access/check",
      version: 1,
      permission: "security:check_access",
      summary: "Unified authorization check across RBAC, ReBAC, and ABAC",
      schema: { body: checkAccessBody },
      handle: ({ body, context }) => {
        const { abac, ...rest } = body;
        return admin.securityAuthorization.checkAccess(context.principal, {
          ...rest,
          ...(abac !== undefined ? { abac: abac as AbacCondition } : {}),
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/security/access/evaluate",
      version: 1,
      permission: "security:evaluate_access",
      summary: "The zero-trust access evaluation (the platform's single authorization entry point)",
      schema: { body: evaluateAccessBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.evaluateAccess(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/policy-fragments",
      version: 1,
      permission: "security:register_policy_fragment",
      idempotent: true,
      summary: "Register a reusable, versioned policy fragment in the Registry Engine",
      schema: { body: registerPolicyFragmentBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.registerPolicyFragment(context.principal, {
          key: body.key,
          ...(body.description !== undefined ? { description: body.description } : {}),
          expression: body.expression as PolicyExpression,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/permissions",
      version: 1,
      permission: "security:register_permission",
      idempotent: true,
      summary: "Register a permission definition into the discoverable, versioned catalog",
      schema: { body: registerPermissionBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.registerPermission(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/delegations",
      version: 1,
      permission: "security:grant_delegation",
      idempotent: true,
      summary: "Grant a delegation (one principal may act as another, time-boxed)",
      schema: { body: grantDelegationBody },
      handle: ({ body, context }) =>
        admin.securityAuthorization.grantDelegation(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/security/delegations/:delegationId/revoke",
      version: 1,
      permission: "security:revoke_delegation",
      idempotent: true,
      summary: "Revoke a delegation",
      schema: { params: delegationIdParams },
      handle: ({ params, context }) =>
        admin.securityAuthorization.revokeDelegation(context.principal, {
          delegationId: params.delegationId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/delegations/:delegationId/impersonate",
      version: 1,
      permission: "security:start_impersonation",
      idempotent: true,
      summary: "Start an impersonation session under an active delegation",
      schema: { params: delegationIdParams, body: startImpersonationBody },
      handle: ({ params, body, context }) =>
        admin.securityAuthorization.startImpersonation(context.principal, {
          delegationId: params.delegationId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/consent/:subjectRef",
      version: 1,
      permission: "security:check_consent",
      summary: "Read the latest projected consent decision for a subject/purpose (fail-closed)",
      schema: { params: subjectRefParams, querystring: checkConsentQuery },
      handle: ({ params, query, context }) =>
        admin.securityAuthorization.checkConsent(context.principal, {
          subjectRef: params.subjectRef,
          ...query,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/tenants/:tenantRef/security-profile",
      version: 1,
      permission: "security:configure_tenant_security",
      idempotent: true,
      summary:
        "Configure (or reconfigure) a tenant's security profile (idempotent create-or-patch)",
      schema: { params: tenantRefParams, body: configureTenantSecurityBody },
      handle: ({ params, body, context }) =>
        admin.securityAuthorization.configureTenantSecurity(context.principal, {
          tenantRef: params.tenantRef,
          config: body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/permission-explorer",
      version: 1,
      permission: "security:permission_explorer",
      summary: "Console read model — permission explorer",
      schema: {},
      handle: ({ context }) => admin.securityAuthorization.permissionExplorer(context.principal),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/policy-explorer",
      version: 1,
      permission: "security:policy_explorer",
      summary: "Console read model — policy explorer",
      schema: {},
      handle: ({ context }) => admin.securityAuthorization.policyExplorer(context.principal),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/registry-explorer",
      version: 1,
      permission: "security:registry_explorer",
      summary: "Console read model — security registry explorer",
      schema: {},
      handle: ({ context }) => admin.securityAuthorization.registryExplorer(context.principal),
    }),
  ] as readonly RouteDefinition[];
}
