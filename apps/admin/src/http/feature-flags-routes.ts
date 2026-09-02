import { z } from "zod";
import type { FeatureFlag } from "@platform/feature-flags-service";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface FeatureEnvironmentDto {
  readonly environment: string;
  readonly enabled: boolean;
  readonly rolloutPercentage: number | null;
}

export interface FeatureRuleDto {
  readonly type: string;
  readonly attribute: string | null;
  readonly values: readonly string[];
  readonly enabled: boolean;
}

export interface FlagChangeDto {
  readonly action: string;
  readonly changedBy: string;
  readonly details: string | null;
  readonly occurredAt: string;
}

export interface FeatureFlagDto {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly environments: readonly FeatureEnvironmentDto[];
  readonly rules: readonly FeatureRuleDto[];
  readonly rolloutPercentage: number;
  readonly changes: readonly FlagChangeDto[];
}

function toFeatureFlagDto(flag: FeatureFlag): FeatureFlagDto {
  return {
    id: flag.id.toString(),
    key: flag.key,
    name: flag.name,
    description: flag.description ?? null,
    status: flag.status.value,
    environments: flag.environments.map((e) => ({
      environment: e.environment,
      enabled: e.enabled,
      rolloutPercentage: e.rolloutPercentage ?? null,
    })),
    rules: flag.rules.map((r) => ({
      type: r.type,
      attribute: r.attribute ?? null,
      values: r.values,
      enabled: r.enabled,
    })),
    rolloutPercentage: flag.rolloutPercentage,
    changes: flag.changes.map((c) => ({
      action: c.action,
      changedBy: c.changedBy,
      details: c.details ?? null,
      occurredAt: c.occurredAt.toISOString(),
    })),
  };
}

const createFlagBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});
const flagIdParams = z.object({ flagId: z.string().min(1) });
const advanceFlagBody = z.object({
  toStatus: z.enum(["active", "killed", "archived"]),
  changedBy: z.string().min(1),
});
const setRolloutBody = z.object({
  percentage: z.number().min(0).max(100),
  changedBy: z.string().min(1),
});
const addRuleBody = z.object({
  type: z.enum(["tenant", "user", "attribute"]),
  values: z.array(z.string().min(1)),
  enabled: z.boolean(),
  attribute: z.string().min(1).optional(),
  changedBy: z.string().min(1),
});
const setEnvironmentOverrideBody = z.object({
  environment: z.string().min(1),
  enabled: z.boolean(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  changedBy: z.string().min(1),
});

/** The Feature Flags admin HTTP surface (Sprint S1). Pure delegation. */
export function featureFlagsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/feature-flags",
      version: 1,
      permission: "feature_flags:create",
      idempotent: true,
      summary: "Create a feature flag (active, 0% rollout)",
      schema: { body: createFlagBody },
      handle: ({ body, context }) => admin.featureFlags.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-flags/:flagId/transitions",
      version: 1,
      permission: "feature_flags:advance",
      idempotent: true,
      summary: "Advance a flag's status (kill/revive/archive)",
      schema: { params: flagIdParams, body: advanceFlagBody },
      handle: ({ params, body, context }) =>
        admin.featureFlags.advance(context.principal, { flagId: params.flagId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-flags/:flagId/rollout",
      version: 1,
      permission: "feature_flags:set_rollout",
      idempotent: true,
      summary: "Set a flag's rollout percentage",
      schema: { params: flagIdParams, body: setRolloutBody },
      handle: ({ params, body, context }) =>
        admin.featureFlags.setRollout(context.principal, { flagId: params.flagId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-flags/:flagId/rules",
      version: 1,
      permission: "feature_flags:add_rule",
      summary: "Add a targeting rule to a flag",
      schema: { params: flagIdParams, body: addRuleBody },
      handle: ({ params, body, context }) =>
        admin.featureFlags.addRule(context.principal, { flagId: params.flagId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-flags/:flagId/environment-overrides",
      version: 1,
      permission: "feature_flags:set_environment_override",
      idempotent: true,
      summary: "Set a per-environment override on a flag",
      schema: { params: flagIdParams, body: setEnvironmentOverrideBody },
      handle: ({ params, body, context }) =>
        admin.featureFlags.setEnvironmentOverride(context.principal, {
          flagId: params.flagId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/feature-flags",
      version: 1,
      permission: "feature_flags:read",
      summary: "List feature flags (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.featureFlags.list(context.principal, query), toFeatureFlagDto),
    }),
    defineRoute({
      method: "GET",
      path: "/feature-flags/:flagId",
      version: 1,
      permission: "feature_flags:read",
      summary: "Get one feature flag by id",
      schema: { params: flagIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.featureFlags.get(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toFeatureFlagDto(response.body as FeatureFlag) };
      },
    }),
  ] as readonly RouteDefinition[];
}
