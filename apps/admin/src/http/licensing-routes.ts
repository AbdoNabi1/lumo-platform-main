import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const createPlanBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  tier: z.enum(["free", "starter", "growth", "pro", "enterprise", "custom"]),
});
const planIdParams = z.object({ planId: z.string().min(1) });
const createPlanDraftBody = z.object({
  spec: z.object({
    limits: z.record(z.string(), z.number()),
    featureEntitlements: z.array(z.string()),
    pricing: z.object({
      basePrice: z.number(),
      billingCycle: z.enum(["monthly", "annual"]),
      trialDays: z.number().optional(),
      creditAllowances: z.record(z.string(), z.number()),
    }),
  }),
});
const planVersionParams = z.object({ planId: z.string().min(1), planVersionId: z.string().min(1) });
const createSubscriptionBody = z.object({
  tenantRef: z.string().min(1),
  planVersionRef: z.string().min(1),
});
const subscriptionIdParams = z.object({ subscriptionId: z.string().min(1) });
const repinSubscriptionBody = z.object({ newPlanVersionRef: z.string().min(1) });
const cancelSubscriptionBody = z.object({ reason: z.string().min(1) });
const setMerchantFeatureOverrideBody = z.object({
  tenantRef: z.string().min(1),
  featureKey: z.string().min(1),
  state: z.enum(["enabled", "disabled", "temp_grant", "temp_block"]),
  expiresAt: z.coerce.date().optional(),
  notes: z.string().optional(),
});
const grantMerchantCapabilityBody = z.object({
  tenantRef: z.string().min(1),
  featureKey: z.string().min(1),
  enabled: z.boolean(),
  source: z.enum(["manual", "temporary", "trial", "beta", "enterprise", "sales", "support"]),
  expiresAt: z.coerce.date().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
});
const usageCounterQuery = z.object({ tenantRef: z.string().min(1), resource: z.string().min(1) });
const createInvoiceBody = z.object({
  tenantRef: z.string().min(1),
  subscriptionRef: z.string().min(1),
  currency: z.string().min(1),
  lineItems: z.array(z.object({ description: z.string().min(1), amount: z.number() })),
});
const invoiceIdParams = z.object({ invoiceId: z.string().min(1) });
const grantCreditBody = z.object({
  tenantRef: z.string().min(1),
  amount: z.number(),
  reason: z.string().min(1),
});

/** The Licensing admin HTTP surface (Sprint 5.5/5.6). Pure delegation. */
export function licensingRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/plans",
      version: 1,
      permission: "licensing:plan:manage",
      idempotent: true,
      summary: "Create a plan",
      schema: { body: createPlanBody },
      handle: ({ body, context }) =>
        admin.licensing.createPlan(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/plans/:planId/drafts",
      version: 1,
      permission: "licensing:plan:manage",
      idempotent: true,
      summary: "Create a plan draft version",
      schema: { params: planIdParams, body: createPlanDraftBody },
      handle: ({ params, body, context }) =>
        admin.licensing.createPlanDraft(context.principal, {
          ...params,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/plans/:planId/versions/:planVersionId/publish",
      version: 1,
      permission: "licensing:plan:manage",
      idempotent: true,
      summary: "Publish a plan version",
      schema: { params: planVersionParams },
      handle: ({ params, context }) =>
        admin.licensing.publishPlanVersion(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/plans/:planId/versions/:planVersionId/rollback",
      version: 1,
      permission: "licensing:plan:manage",
      idempotent: true,
      summary: "Roll back the published plan version pointer",
      schema: { params: planVersionParams },
      handle: ({ params, context }) =>
        admin.licensing.rollbackPlan(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/subscriptions",
      version: 1,
      permission: "licensing:subscription:manage",
      idempotent: true,
      summary: "Start a subscription",
      schema: { body: createSubscriptionBody },
      handle: ({ body, context }) =>
        admin.licensing.createSubscription(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/subscriptions/:subscriptionId/repin",
      version: 1,
      permission: "licensing:subscription:manage",
      idempotent: true,
      summary: "Re-pin a subscription to a different plan version",
      schema: { params: subscriptionIdParams, body: repinSubscriptionBody },
      handle: ({ params, body, context }) =>
        admin.licensing.repinSubscription(context.principal, {
          ...params,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/subscriptions/:subscriptionId/cancel",
      version: 1,
      permission: "licensing:subscription:manage",
      idempotent: true,
      summary: "Cancel a subscription",
      schema: { params: subscriptionIdParams, body: cancelSubscriptionBody },
      handle: ({ params, body, context }) =>
        admin.licensing.cancelSubscription(context.principal, {
          ...params,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/merchant-feature-overrides",
      version: 1,
      permission: "licensing:override:manage",
      idempotent: true,
      summary: "Set the legacy merchant feature override",
      schema: { body: setMerchantFeatureOverrideBody },
      handle: ({ body, context }) =>
        admin.licensing.setMerchantFeatureOverride(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/merchant-capabilities",
      version: 1,
      permission: "licensing:override:manage",
      idempotent: true,
      summary: "Grant a merchant capability",
      schema: { body: grantMerchantCapabilityBody },
      handle: ({ body, context }) =>
        admin.licensing.grantMerchantCapability(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/usage-counters",
      version: 1,
      permission: "licensing:usage:read",
      idempotent: true,
      summary: "Read a tenant's current usage for one resource",
      schema: { querystring: usageCounterQuery },
      handle: ({ query, context }) =>
        admin.licensing.getUsageCounter(context.principal, {
          ...query,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/invoices",
      version: 1,
      permission: "licensing:billing:manage",
      idempotent: true,
      summary: "Create a draft invoice",
      schema: { body: createInvoiceBody },
      handle: ({ body, context }) =>
        admin.licensing.createInvoice(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/invoices/:invoiceId/collect",
      version: 1,
      permission: "licensing:billing:manage",
      idempotent: true,
      summary: "Collect an issued invoice through Payments and post to Finance",
      schema: { params: invoiceIdParams },
      handle: ({ params, context }) =>
        admin.licensing.collectInvoice(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/credits",
      version: 1,
      permission: "licensing:billing:manage",
      idempotent: true,
      summary: "Grant a billing credit",
      schema: { body: grantCreditBody },
      handle: ({ body, context }) =>
        admin.licensing.grantCredit(context.principal, { ...body, tenantId: context.tenantId }),
    }),
  ] as readonly RouteDefinition[];
}
