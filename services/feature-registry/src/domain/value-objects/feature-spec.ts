/**
 * Feature Registry value objects (ADR-0027). A `FeatureDefinition` owns the *definition* of a platform capability
 * — never its state, never a subscription, never a developer flag. Each published version is an immutable snapshot
 * (the same versioned-immutable discipline as `licensing.PlanVersion`), so a consumer that pins a feature version
 * is never affected by later edits.
 */

export type FeatureVisibility = "public" | "internal" | "beta" | "hidden";
export const FEATURE_VISIBILITIES: readonly FeatureVisibility[] = [
  "public",
  "internal",
  "beta",
  "hidden",
];
export function isFeatureVisibility(value: string): value is FeatureVisibility {
  return (FEATURE_VISIBILITIES as readonly string[]).includes(value);
}

/** The definition lifecycle. `removed` is a **soft** removal — the record and its history are retained. */
export type FeatureLifecycle = "draft" | "active" | "deprecated" | "removed";

/** A dependency on another feature (bare key reference — D-002). `minVersion` 0 means "any published version". */
export interface FeatureDependency {
  readonly featureKey: string;
  readonly minVersion: number;
}

/** What a tenant must hold for the feature to be entitled (resolved by Licensing's EntitlementResolver). */
export interface FeatureRequirements {
  readonly requiredPlans: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly requiredCapabilities: readonly string[];
}

export function emptyRequirements(): FeatureRequirements {
  return { requiredPlans: [], requiredPermissions: [], requiredCapabilities: [] };
}

/** Canonical logical groupings (P1.1.1 §1). Metadata only — never affects runtime logic. Open for extension. */
export const FEATURE_GROUPS: readonly string[] = [
  "commerce",
  "ai",
  "marketing",
  "automation",
  "analytics",
  "operations",
  "developer",
  "infrastructure",
];

/**
 * The compatibility matrix for a feature (P1.1.1 §9). Bare-key references (D-002). Single-value fields use `""`
 * (sentinel, never null) for "none". Future AI + Marketplace depend on this; the Feature Registry only records it.
 */
export interface FeatureCompatibility {
  readonly compatibleWith: readonly string[];
  readonly requires: readonly string[];
  readonly conflictsWith: readonly string[];
  readonly replaces: readonly string[];
  readonly deprecatedBy: string;
  readonly migrationTarget: string;
}

export function emptyCompatibility(): FeatureCompatibility {
  return {
    compatibleWith: [],
    requires: [],
    conflictsWith: [],
    replaces: [],
    deprecatedBy: "",
    migrationTarget: "",
  };
}

/** AI-facing metadata (P1.1.1 §10). Metadata only — the Feature Registry contains no AI logic. */
export interface FeatureAiMetadata {
  readonly aiDescription: string;
  readonly businessDescription: string;
  readonly technicalDescription: string;
  readonly tags: readonly string[];
  readonly useCases: readonly string[];
  readonly relatedFeatures: readonly string[];
  readonly examples: readonly string[];
}

export function emptyAiMetadata(): FeatureAiMetadata {
  return {
    aiDescription: "",
    businessDescription: "",
    technicalDescription: "",
    tags: [],
    useCases: [],
    relatedFeatures: [],
    examples: [],
  };
}

/** Product lifecycle stage (P1.1.2 §1) — metadata; never changes runtime behavior. Consumed by other contexts. */
export type FeatureLifecyclePolicy =
  | "experimental"
  | "beta"
  | "early_access"
  | "general_availability"
  | "legacy"
  | "deprecated"
  | "sunset"
  | "internal_only"
  | "hidden";
export const FEATURE_LIFECYCLE_POLICIES: readonly FeatureLifecyclePolicy[] = [
  "experimental",
  "beta",
  "early_access",
  "general_availability",
  "legacy",
  "deprecated",
  "sunset",
  "internal_only",
  "hidden",
];
export function isFeatureLifecyclePolicy(value: string): value is FeatureLifecyclePolicy {
  return (FEATURE_LIFECYCLE_POLICIES as readonly string[]).includes(value);
}

/** Canonical constraint keys (P1.1.2 §2). Feature Registry DEFINES limits; Licensing ENFORCES; Usage MEASURES. */
export const FEATURE_CONSTRAINT_KEYS: readonly string[] = [
  "maxInstances",
  "maxProjects",
  "maxUsers",
  "maxSeats",
  "maxApiKeys",
  "maxWorkflows",
  "maxStorage",
  "maxAiCredits",
  "maxTokens",
  "maxConnections",
  "maxIntegrations",
  "maxRequests",
];
/** A constraint map: constraint key → numeric limit (-1 = unlimited). Definitions only. */
export type FeatureConstraints = Readonly<Record<string, number>>;

/** Cost weights for future billing/AI-cost/marketplace/revenue-intelligence (P1.1.2 §3). Metadata only. */
export interface FeatureCostProfile {
  readonly estimatedCost: number;
  readonly billingStrategy: string;
  readonly resourceCategory: string;
  readonly cpuWeight: number;
  readonly memoryWeight: number;
  readonly storageWeight: number;
  readonly gpuWeight: number;
  readonly networkWeight: number;
  readonly aiWeight: number;
  readonly executionWeight: number;
}

export function emptyCostProfile(): FeatureCostProfile {
  return {
    estimatedCost: 0,
    billingStrategy: "",
    resourceCategory: "",
    cpuWeight: 0,
    memoryWeight: 0,
    storageWeight: 0,
    gpuWeight: 0,
    networkWeight: 0,
    aiWeight: 0,
    executionWeight: 0,
  };
}

/** Documentation pointers for Developer Portal / Marketplace / AI Assistant (P1.1.2 §4). Metadata only. */
export interface FeatureDocumentation {
  readonly documentationUrl: string;
  readonly developerGuide: string;
  readonly sdkReference: string;
  readonly apiReference: string;
  readonly examples: readonly string[];
  readonly tutorials: readonly string[];
  readonly changelog: string;
  readonly migrationGuide: string;
  readonly releaseNotes: string;
  readonly faq: string;
}

export function emptyDocumentation(): FeatureDocumentation {
  return {
    documentationUrl: "",
    developerGuide: "",
    sdkReference: "",
    apiReference: "",
    examples: [],
    tutorials: [],
    changelog: "",
    migrationGuide: "",
    releaseNotes: "",
    faq: "",
  };
}

/** Analytics/scoring metadata for Platform Console / AI / Marketplace / Growth (P1.1.2 §8). Metadata only. */
export interface FeatureAnalyticsMetadata {
  readonly adoptionScore: number;
  readonly usageScore: number;
  readonly popularity: number;
  readonly stability: number;
  readonly maturity: number;
  readonly businessValue: number;
  readonly technicalComplexity: number;
}

export function emptyAnalyticsMetadata(): FeatureAnalyticsMetadata {
  return {
    adoptionScore: 0,
    usageScore: 0,
    popularity: 0,
    stability: 0,
    maturity: 0,
    businessValue: 0,
    technicalComplexity: 0,
  };
}

/**
 * The immutable content of one feature version. `groups`/`compatibility`/`ai` are additive (P1.1.1);
 * `lifecyclePolicy`/`constraints`/`cost`/`documentation`/`analytics` are additive (P1.1.2). All are metadata/
 * definitions — none change runtime behavior directly.
 */
export interface FeatureSpec {
  readonly category: string;
  readonly visibility: FeatureVisibility;
  readonly description: string;
  readonly dependencies: readonly FeatureDependency[];
  readonly requirements: FeatureRequirements;
  readonly groups: readonly string[];
  readonly compatibility: FeatureCompatibility;
  readonly ai: FeatureAiMetadata;
  readonly lifecyclePolicy: FeatureLifecyclePolicy;
  readonly constraints: FeatureConstraints;
  readonly cost: FeatureCostProfile;
  readonly documentation: FeatureDocumentation;
  readonly analytics: FeatureAnalyticsMetadata;
}

export type FeatureVersionStatus = "draft" | "published" | "archived";

/** A single version of a feature definition. `publishedAt` is `""` (sentinel, never null) while unpublished. */
export interface FeatureVersion {
  readonly versionNumber: number;
  readonly status: FeatureVersionStatus;
  readonly spec: FeatureSpec;
  readonly createdAt: string;
  readonly publishedAt: string;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

export function normalizeRequirements(
  input: Partial<FeatureRequirements> | undefined,
): FeatureRequirements {
  return {
    requiredPlans: dedupe(input?.requiredPlans ?? []),
    requiredPermissions: dedupe(input?.requiredPermissions ?? []),
    requiredCapabilities: dedupe(input?.requiredCapabilities ?? []),
  };
}

export function normalizeDependencies(
  input: readonly FeatureDependency[] | undefined,
): readonly FeatureDependency[] {
  const seen = new Set<string>();
  const out: FeatureDependency[] = [];
  for (const dep of input ?? []) {
    const key = dep.featureKey.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      featureKey: key,
      minVersion:
        Number.isFinite(dep.minVersion) && dep.minVersion > 0 ? Math.floor(dep.minVersion) : 0,
    });
  }
  return out;
}

export function normalizeGroups(input: readonly string[] | undefined): readonly string[] {
  return dedupe(input ?? []);
}

export function normalizeCompatibility(
  input: Partial<FeatureCompatibility> | undefined,
): FeatureCompatibility {
  return {
    compatibleWith: dedupe(input?.compatibleWith ?? []),
    requires: dedupe(input?.requires ?? []),
    conflictsWith: dedupe(input?.conflictsWith ?? []),
    replaces: dedupe(input?.replaces ?? []),
    deprecatedBy: (input?.deprecatedBy ?? "").trim(),
    migrationTarget: (input?.migrationTarget ?? "").trim(),
  };
}

export function normalizeAiMetadata(
  input: Partial<FeatureAiMetadata> | undefined,
): FeatureAiMetadata {
  return {
    aiDescription: (input?.aiDescription ?? "").trim(),
    businessDescription: (input?.businessDescription ?? "").trim(),
    technicalDescription: (input?.technicalDescription ?? "").trim(),
    tags: dedupe(input?.tags ?? []),
    useCases: dedupe(input?.useCases ?? []),
    relatedFeatures: dedupe(input?.relatedFeatures ?? []),
    examples: (input?.examples ?? []).map((e) => e.trim()).filter((e) => e.length > 0),
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeConstraints(
  input: Readonly<Record<string, number>> | undefined,
): FeatureConstraints {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const key = k.trim();
    if (key.length > 0 && typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

export function normalizeCostProfile(
  input: Partial<FeatureCostProfile> | undefined,
): FeatureCostProfile {
  return {
    estimatedCost: num(input?.estimatedCost),
    billingStrategy: (input?.billingStrategy ?? "").trim(),
    resourceCategory: (input?.resourceCategory ?? "").trim(),
    cpuWeight: num(input?.cpuWeight),
    memoryWeight: num(input?.memoryWeight),
    storageWeight: num(input?.storageWeight),
    gpuWeight: num(input?.gpuWeight),
    networkWeight: num(input?.networkWeight),
    aiWeight: num(input?.aiWeight),
    executionWeight: num(input?.executionWeight),
  };
}

export function normalizeDocumentation(
  input: Partial<FeatureDocumentation> | undefined,
): FeatureDocumentation {
  const s = (v: string | undefined): string => (v ?? "").trim();
  return {
    documentationUrl: s(input?.documentationUrl),
    developerGuide: s(input?.developerGuide),
    sdkReference: s(input?.sdkReference),
    apiReference: s(input?.apiReference),
    examples: (input?.examples ?? []).map((e) => e.trim()).filter((e) => e.length > 0),
    tutorials: (input?.tutorials ?? []).map((e) => e.trim()).filter((e) => e.length > 0),
    changelog: s(input?.changelog),
    migrationGuide: s(input?.migrationGuide),
    releaseNotes: s(input?.releaseNotes),
    faq: s(input?.faq),
  };
}

export function normalizeAnalyticsMetadata(
  input: Partial<FeatureAnalyticsMetadata> | undefined,
): FeatureAnalyticsMetadata {
  return {
    adoptionScore: num(input?.adoptionScore),
    usageScore: num(input?.usageScore),
    popularity: num(input?.popularity),
    stability: num(input?.stability),
    maturity: num(input?.maturity),
    businessValue: num(input?.businessValue),
    technicalComplexity: num(input?.technicalComplexity),
  };
}

/** Fills additive P1.1.1 + P1.1.2 fields on a possibly-older deserialized spec (backward compatibility). */
export function hydrateSpec(
  spec: Partial<FeatureSpec> & { category: string; visibility: FeatureVisibility },
): FeatureSpec {
  return {
    category: spec.category,
    visibility: spec.visibility,
    description: spec.description ?? "",
    dependencies: normalizeDependencies(spec.dependencies),
    requirements: normalizeRequirements(spec.requirements),
    groups: normalizeGroups(spec.groups),
    compatibility: normalizeCompatibility(spec.compatibility),
    ai: normalizeAiMetadata(spec.ai),
    lifecyclePolicy:
      spec.lifecyclePolicy !== undefined && isFeatureLifecyclePolicy(spec.lifecyclePolicy)
        ? spec.lifecyclePolicy
        : "experimental",
    constraints: normalizeConstraints(spec.constraints),
    cost: normalizeCostProfile(spec.cost),
    documentation: normalizeDocumentation(spec.documentation),
    analytics: normalizeAnalyticsMetadata(spec.analytics),
  };
}

export function normalizeSpec(input: {
  category: string;
  visibility: FeatureVisibility;
  description?: string;
  dependencies?: readonly FeatureDependency[];
  requirements?: Partial<FeatureRequirements>;
  groups?: readonly string[];
  compatibility?: Partial<FeatureCompatibility>;
  ai?: Partial<FeatureAiMetadata>;
  lifecyclePolicy?: FeatureLifecyclePolicy;
  constraints?: Readonly<Record<string, number>>;
  cost?: Partial<FeatureCostProfile>;
  documentation?: Partial<FeatureDocumentation>;
  analytics?: Partial<FeatureAnalyticsMetadata>;
}): FeatureSpec {
  return {
    category: input.category.trim(),
    visibility: input.visibility,
    description: (input.description ?? "").trim(),
    dependencies: normalizeDependencies(input.dependencies),
    requirements: normalizeRequirements(input.requirements),
    groups: normalizeGroups(input.groups),
    compatibility: normalizeCompatibility(input.compatibility),
    ai: normalizeAiMetadata(input.ai),
    lifecyclePolicy: input.lifecyclePolicy ?? "experimental",
    constraints: normalizeConstraints(input.constraints),
    cost: normalizeCostProfile(input.cost),
    documentation: normalizeDocumentation(input.documentation),
    analytics: normalizeAnalyticsMetadata(input.analytics),
  };
}
