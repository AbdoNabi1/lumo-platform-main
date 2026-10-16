import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const aiIsolationLevelEnum = z.enum(["none", "sandboxed", "isolated"]);
const aiGovernanceConfigSchema = z.object({
  tokenBudget: z.number().int().min(0).nullable().optional(),
  callQuota: z.number().int().min(0).nullable().optional(),
  windowSeconds: z.number().int().positive().optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  allowedResources: z.array(z.string().min(1)).optional(),
  isolationLevel: aiIsolationLevelEnum.optional(),
});

const principalExternalIdParams = z.object({ externalId: z.string().min(1) });
const governAiIdentityBody = z.object({ config: aiGovernanceConfigSchema });
const checkAiActionBody = z.object({
  tool: z.string().optional(),
  resource: z.string().optional(),
  tokens: z.number().int().min(0).optional(),
  calls: z.number().int().min(0).optional(),
});

/** S1.5.6 — AI Governance admin HTTP surface for Security. Pure delegation. */
export function securityAiGovernanceRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/security/ai-identities/:externalId",
      version: 1,
      permission: "security:govern_ai_identity",
      idempotent: true,
      summary:
        "Govern an AI principal's budgets/quotas/sandboxing/isolation (idempotent create-or-patch)",
      schema: { params: principalExternalIdParams, body: governAiIdentityBody },
      handle: ({ params, body, context }) =>
        admin.securityAiGovernance.governAiIdentity(context.principal, {
          tenantId: context.tenantId,
          principalExternalId: params.externalId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/ai-identities/:externalId/suspend",
      version: 1,
      permission: "security:suspend_ai_identity",
      idempotent: true,
      summary: "Suspend an AI identity (kill-switch)",
      schema: { params: principalExternalIdParams },
      handle: ({ params, context }) =>
        admin.securityAiGovernance.suspendAiIdentity(context.principal, {
          tenantId: context.tenantId,
          principalExternalId: params.externalId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/security/ai-identities/:externalId/actions/check",
      version: 1,
      permission: "security:check_ai_action",
      summary: "The AI action gate — checks sandboxing, isolation, and budget/quota in one call",
      schema: { params: principalExternalIdParams, body: checkAiActionBody },
      handle: ({ params, body, context }) =>
        admin.securityAiGovernance.checkAiAction(context.principal, {
          tenantId: context.tenantId,
          principalExternalId: params.externalId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/security/console/ai-governance-explorer",
      version: 1,
      permission: "security:ai_governance_explorer",
      summary: "Console read model — AI governance explorer",
      schema: {},
      handle: ({ context }) =>
        admin.securityAiGovernance.aiGovernanceExplorer(context.principal, context.tenantId),
    }),
  ] as readonly RouteDefinition[];
}
