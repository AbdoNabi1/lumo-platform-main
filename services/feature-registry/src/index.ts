export { wireFeatureRegistry } from "./composition";
export type { FeatureRegistryWiringDeps, WiredFeatureRegistry } from "./composition";
export { FeatureRegistryController } from "./interfaces/feature-registry.controller";
export type { FeatureRegistryUseCases } from "./interfaces/feature-registry.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { CompositeEntitlementPort } from "./interfaces/entitlement-port.adapter";
export type {
  CompositeEntitlementDeps,
  LicensingDecision,
} from "./interfaces/entitlement-port.adapter";
export { FeatureDefinition } from "./domain/feature-definition";
export type { RegisterFeatureProps } from "./domain/feature-definition";
export { FeatureBundle } from "./domain/feature-bundle";
export type { CreateBundleProps, FeatureBundleStatus } from "./domain/feature-bundle";
export { CapabilityGraph } from "./domain/capability-graph";
export type { CapabilityGraphNode, CompatibilityGap } from "./domain/capability-graph";
export { FeatureRegistryValidator } from "./domain/feature-registry-validator";
export type {
  RegistryValidationReport,
  ValidationIssue,
  ValidationSeverity,
} from "./domain/feature-registry-validator";
export {
  FEATURE_VISIBILITIES,
  FEATURE_GROUPS,
  FEATURE_LIFECYCLE_POLICIES,
  FEATURE_CONSTRAINT_KEYS,
  isFeatureVisibility,
  isFeatureLifecyclePolicy,
  emptyRequirements,
  emptyCompatibility,
  emptyAiMetadata,
  emptyCostProfile,
  emptyDocumentation,
  emptyAnalyticsMetadata,
  normalizeSpec,
} from "./domain/value-objects/feature-spec";
export type {
  FeatureVisibility,
  FeatureLifecycle,
  FeatureLifecyclePolicy,
  FeatureDependency,
  FeatureRequirements,
  FeatureCompatibility,
  FeatureAiMetadata,
  FeatureConstraints,
  FeatureCostProfile,
  FeatureDocumentation,
  FeatureAnalyticsMetadata,
  FeatureSpec,
  FeatureVersion,
  FeatureVersionStatus,
} from "./domain/value-objects/feature-spec";
export type { FeatureDefinitionRepository, FeatureBundleRepository } from "./domain/repositories";
export {
  PrismaFeatureDefinitionRepository,
  PrismaFeatureBundleRepository,
} from "./infrastructure/prisma-repositories";
export type {
  FeatureOutput,
  ResolvedFeature,
  BundleOutput,
  CapabilityGraphOutput,
} from "./application/feature-registry.use-cases";
/** Canonical integration events Feature Registry publishes (runtime-verified by `featureRegistryModule`). */
export { FEATURE_REGISTRY_PUBLISHED_EVENTS } from "./infrastructure/feature-registry-event-translator";
