import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const visibilityEnum = z.enum(["public", "internal", "beta", "hidden"]);
const lifecyclePolicyEnum = z.enum([
  "experimental",
  "beta",
  "early_access",
  "general_availability",
  "legacy",
  "deprecated",
  "sunset",
  "internal_only",
  "hidden",
]);
const dependencySchema = z.object({
  featureKey: z.string().min(1),
  minVersion: z.number().int().min(0),
});
const requirementsSchema = z.object({
  requiredPlans: z.array(z.string().min(1)).optional(),
  requiredPermissions: z.array(z.string().min(1)).optional(),
  requiredCapabilities: z.array(z.string().min(1)).optional(),
});
const compatibilitySchema = z.object({
  compatibleWith: z.array(z.string().min(1)).optional(),
  requires: z.array(z.string().min(1)).optional(),
  conflictsWith: z.array(z.string().min(1)).optional(),
  replaces: z.array(z.string().min(1)).optional(),
  deprecatedBy: z.string().optional(),
  migrationTarget: z.string().optional(),
});
const aiMetadataSchema = z.object({
  aiDescription: z.string().optional(),
  businessDescription: z.string().optional(),
  technicalDescription: z.string().optional(),
  tags: z.array(z.string()).optional(),
  useCases: z.array(z.string()).optional(),
  relatedFeatures: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
});
const costProfileSchema = z.object({
  estimatedCost: z.number().optional(),
  billingStrategy: z.string().optional(),
  resourceCategory: z.string().optional(),
  cpuWeight: z.number().optional(),
  memoryWeight: z.number().optional(),
  storageWeight: z.number().optional(),
  gpuWeight: z.number().optional(),
  networkWeight: z.number().optional(),
  aiWeight: z.number().optional(),
  executionWeight: z.number().optional(),
});
const documentationSchema = z.object({
  documentationUrl: z.string().optional(),
  developerGuide: z.string().optional(),
  sdkReference: z.string().optional(),
  apiReference: z.string().optional(),
  examples: z.array(z.string()).optional(),
  tutorials: z.array(z.string()).optional(),
  changelog: z.string().optional(),
  migrationGuide: z.string().optional(),
  releaseNotes: z.string().optional(),
  faq: z.string().optional(),
});
const analyticsMetadataSchema = z.object({
  adoptionScore: z.number().optional(),
  usageScore: z.number().optional(),
  popularity: z.number().optional(),
  stability: z.number().optional(),
  maturity: z.number().optional(),
  businessValue: z.number().optional(),
  technicalComplexity: z.number().optional(),
});

const featureKeyParams = z.object({ key: z.string().min(1) });

const registerFeatureBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  visibility: visibilityEnum.optional(),
  description: z.string().optional(),
  dependencies: z.array(dependencySchema).optional(),
  requirements: requirementsSchema.optional(),
});
const editFeatureDraftBody = z.object({
  name: z.string().optional(),
  category: z.string().optional(),
  visibility: visibilityEnum.optional(),
  description: z.string().optional(),
});
const declareDependenciesBody = z.object({ dependencies: z.array(dependencySchema) });
const setRequirementsBody = z.object({ requirements: requirementsSchema });
const setGroupsBody = z.object({ groups: z.array(z.string().min(1)) });
const setCompatibilityBody = z.object({ compatibility: compatibilitySchema });
const setAiMetadataBody = z.object({ ai: aiMetadataSchema });
const setMetadataBody = z.object({
  lifecyclePolicy: lifecyclePolicyEnum.optional(),
  constraints: z.record(z.number()).optional(),
  cost: costProfileSchema.optional(),
  documentation: documentationSchema.optional(),
  analytics: analyticsMetadataSchema.optional(),
});
const advanceFeatureBody = z.object({
  to: z.enum(["publish", "revise", "deprecate", "remove"]),
});
const replaceFeatureBody = z.object({ replacementKey: z.string().min(1) });
const listFeaturesQuery = z.object({
  lifecycle: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
});
const analyzeGraphQuery = z.object({ key: z.string().min(1).optional() });

const bundleKeyParams = z.object({ key: z.string().min(1) });
const createBundleBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  featureKeys: z.array(z.string().min(1)).optional(),
  groups: z.array(z.string().min(1)).optional(),
});
const updateBundleBody = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  featureKeys: z.array(z.string().min(1)).optional(),
  groups: z.array(z.string().min(1)).optional(),
  archive: z.boolean().optional(),
});

/** The Feature Registry admin HTTP surface (Sprint S1). Pure delegation. */
export function featureRegistryRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/feature-registry/features",
      version: 1,
      permission: "feature_registry:register",
      idempotent: true,
      summary: "Register a new feature definition with an initial draft (idempotent per key)",
      schema: { body: registerFeatureBody },
      handle: ({ body, context }) =>
        admin.featureRegistry.register(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/draft",
      version: 1,
      permission: "feature_registry:edit_draft",
      idempotent: true,
      summary: "Edit a feature's metadata and/or open draft spec",
      schema: { params: featureKeyParams, body: editFeatureDraftBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.editDraft(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/dependencies",
      version: 1,
      permission: "feature_registry:declare_dependencies",
      idempotent: true,
      summary: "Declare a feature's dependencies on other features (open draft)",
      schema: { params: featureKeyParams, body: declareDependenciesBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.declareDependencies(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/requirements",
      version: 1,
      permission: "feature_registry:set_requirements",
      idempotent: true,
      summary: "Set the entitlement requirements on the open draft",
      schema: { params: featureKeyParams, body: setRequirementsBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.setRequirements(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/groups",
      version: 1,
      permission: "feature_registry:set_groups",
      idempotent: true,
      summary: "Assign the feature's open draft to logical groups",
      schema: { params: featureKeyParams, body: setGroupsBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.setGroups(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/compatibility",
      version: 1,
      permission: "feature_registry:set_compatibility",
      idempotent: true,
      summary: "Set the feature's compatibility matrix on the open draft",
      schema: { params: featureKeyParams, body: setCompatibilityBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.setCompatibility(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/ai-metadata",
      version: 1,
      permission: "feature_registry:set_ai_metadata",
      idempotent: true,
      summary: "Set the feature's AI-facing metadata on the open draft",
      schema: { params: featureKeyParams, body: setAiMetadataBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.setAiMetadata(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/metadata",
      version: 1,
      permission: "feature_registry:set_metadata",
      idempotent: true,
      summary: "Set lifecycle policy / constraints / cost / documentation / analytics metadata",
      schema: { params: featureKeyParams, body: setMetadataBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.setMetadata(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/transitions",
      version: 1,
      permission: "feature_registry:advance",
      idempotent: true,
      summary: "Run a lifecycle action (publish draft / open a revision / deprecate / soft-remove)",
      schema: { params: featureKeyParams, body: advanceFeatureBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.advance(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/features/:key/replace",
      version: 1,
      permission: "feature_registry:replace",
      idempotent: true,
      summary: "Deprecate a feature and point it at a replacement",
      schema: { params: featureKeyParams, body: replaceFeatureBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.replace(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/feature-registry/features/:key/resolve",
      version: 1,
      permission: "feature_registry:resolve",
      summary: "Read-only resolution of a feature's requirements and availability",
      schema: { params: featureKeyParams },
      handle: ({ params, context }) =>
        admin.featureRegistry.resolve(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/feature-registry/features",
      version: 1,
      permission: "feature_registry:list",
      summary: "List the feature catalog, optionally filtered by lifecycle/category",
      schema: { querystring: listFeaturesQuery },
      handle: ({ query, context }) =>
        admin.featureRegistry.list(context.principal, { ...query, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "GET",
      path: "/feature-registry/capability-graph",
      version: 1,
      permission: "feature_registry:analyze_graph",
      summary: "Analyze the capability dependency graph (cycles, traversal, impact)",
      schema: { querystring: analyzeGraphQuery },
      handle: ({ query, context }) =>
        admin.featureRegistry.analyzeGraph(context.principal, {
          ...query,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/feature-registry/validate",
      version: 1,
      permission: "feature_registry:validate",
      summary: "Deterministic whole-registry validation report",
      schema: {},
      handle: ({ context }) =>
        admin.featureRegistry.validate(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/bundles",
      version: 1,
      permission: "feature_registry:create_bundle",
      idempotent: true,
      summary: "Create a reusable commercial bundle referencing features (idempotent per key)",
      schema: { body: createBundleBody },
      handle: ({ body, context }) =>
        admin.featureRegistry.createBundle(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/feature-registry/bundles/:key",
      version: 1,
      permission: "feature_registry:update_bundle",
      idempotent: true,
      summary: "Update a bundle's features/metadata, or archive it",
      schema: { params: bundleKeyParams, body: updateBundleBody },
      handle: ({ params, body, context }) =>
        admin.featureRegistry.updateBundle(context.principal, {
          key: params.key,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/feature-registry/bundles",
      version: 1,
      permission: "feature_registry:list_bundles",
      summary: "List the bundle catalog",
      schema: {},
      handle: ({ context }) =>
        admin.featureRegistry.listBundles(context.principal, { tenantId: context.tenantId }),
    }),
  ] as readonly RouteDefinition[];
}
