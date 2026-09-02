import { getAdminApi } from "./client";

/**
 * Feature Registry explorer (T3.4) — one fetch function per GET endpoint in
 * `apps/admin/src/http/feature-registry-routes.ts` (each gated by its own
 * `feature_registry:*` permission, delegated straight through
 * `FeatureRegistryAdminController` -> `services/feature-registry/src/interfaces/
 * feature-registry.controller.ts` -> the use cases in
 * `services/feature-registry/src/application/feature-registry.use-cases.ts`). `present()`
 * (`services/feature-registry/src/interfaces/presenter.ts`) returns each use case's output value
 * verbatim, so the shapes below mirror `FeatureOutput`/`BundleOutput`/`CapabilityGraphOutput`/
 * `RegistryValidationReport` exactly.
 *
 * **No edges endpoint.** `GET /feature-registry/capability-graph` (`AnalyzeCapabilityGraph`,
 * `CapabilityGraphOutput`) returns `{ nodes, cycles, acyclic, focus? }` — never a full edge list.
 * `CapabilityGraph.fromFeatures` (`services/feature-registry/src/domain/capability-graph.ts`)
 * builds its internal graph from each feature's own `dependencies` (relationship: "dependency")
 * and `compatibility.requires` (relationship: "requires") — fields already present on every
 * `FeatureOutput` from `fetchFeatures`. The page derives the edges table from that catalog data
 * (same construction the backend itself uses) rather than fabricating anything or adding a graph
 * library; `fetchCapabilityGraph` still supplies the node count / cycle / acyclic summary, which
 * has no other source.
 */

// ── Shared ───────────────────────────────────────────────────────────────────────────────────────

export interface FeatureDependencyDto {
  readonly featureKey: string;
  readonly minVersion: number;
}

function isFeatureDependencyDto(value: unknown): value is FeatureDependencyDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { featureKey?: unknown }).featureKey === "string" &&
    typeof (value as { minVersion?: unknown }).minVersion === "number"
  );
}

export interface FeatureCompatibilityDto {
  readonly compatibleWith: readonly string[];
  readonly requires: readonly string[];
  readonly conflictsWith: readonly string[];
  readonly replaces: readonly string[];
  readonly deprecatedBy: string;
  readonly migrationTarget: string;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFeatureCompatibilityDto(value: unknown): value is FeatureCompatibilityDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isStringArray(v["compatibleWith"]) &&
    isStringArray(v["requires"]) &&
    isStringArray(v["conflictsWith"]) &&
    isStringArray(v["replaces"]) &&
    typeof v["deprecatedBy"] === "string" &&
    typeof v["migrationTarget"] === "string"
  );
}

/**
 * The feature catalog entry (`FeatureOutput`). `ai`/`constraints`/`cost`/`documentation`/
 * `analytics` are metadata bags this explorer doesn't render field-by-field (Sprint S1's screen
 * is discovery + validation, not the full edit surface) — kept as `Readonly<Record<string,
 * unknown>>` rather than hard-coded per-field, same "self-heals if the backend adds a field"
 * approach `customer-360.ts`'s module doc uses for its own metadata bags.
 */
export interface FeatureOutputDto {
  readonly key: string;
  readonly name: string;
  readonly lifecycle: string;
  readonly category: string;
  readonly visibility: string;
  readonly publishedVersion: number | null;
  readonly versionCount: number;
  readonly hasDraft: boolean;
  readonly replacementKey: string | null;
  readonly requiredPlans: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly dependencies: readonly FeatureDependencyDto[];
  readonly groups: readonly string[];
  readonly compatibility: FeatureCompatibilityDto;
  readonly ai: Readonly<Record<string, unknown>>;
  readonly lifecyclePolicy: string;
  readonly constraints: Readonly<Record<string, unknown>>;
  readonly cost: Readonly<Record<string, unknown>>;
  readonly documentation: Readonly<Record<string, unknown>>;
  readonly analytics: Readonly<Record<string, unknown>>;
}

function isFeatureOutputDto(value: unknown): value is FeatureOutputDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["key"] === "string" &&
    typeof v["name"] === "string" &&
    typeof v["lifecycle"] === "string" &&
    typeof v["category"] === "string" &&
    typeof v["visibility"] === "string" &&
    (v["publishedVersion"] === null || typeof v["publishedVersion"] === "number") &&
    typeof v["versionCount"] === "number" &&
    typeof v["hasDraft"] === "boolean" &&
    (v["replacementKey"] === null || typeof v["replacementKey"] === "string") &&
    isStringArray(v["requiredPlans"]) &&
    isStringArray(v["requiredPermissions"]) &&
    isStringArray(v["requiredCapabilities"]) &&
    Array.isArray(v["dependencies"]) &&
    v["dependencies"].every(isFeatureDependencyDto) &&
    isStringArray(v["groups"]) &&
    isFeatureCompatibilityDto(v["compatibility"]) &&
    typeof v["lifecyclePolicy"] === "string" &&
    typeof v["ai"] === "object" &&
    v["ai"] !== null &&
    typeof v["constraints"] === "object" &&
    v["constraints"] !== null &&
    typeof v["cost"] === "object" &&
    v["cost"] !== null &&
    typeof v["documentation"] === "object" &&
    v["documentation"] !== null &&
    typeof v["analytics"] === "object" &&
    v["analytics"] !== null
  );
}

function toSimpleResult<T>(
  result:
    | { readonly outcome: "ok"; readonly data: T }
    | { readonly outcome: "unauthorized" }
    | { readonly outcome: "not_found" }
    | { readonly outcome: "error"; readonly message: string },
):
  | { readonly outcome: "ok"; readonly data: T }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string } {
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "error", message: "Not found" };
  return { outcome: "error", message: result.message };
}

// ── Feature catalog ──────────────────────────────────────────────────────────────────────────────

interface FeatureListDto {
  readonly features: readonly FeatureOutputDto[];
}

function isFeatureListDto(value: unknown): value is FeatureListDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { features?: unknown }).features) &&
    (value as { features: readonly unknown[] }).features.every(isFeatureOutputDto)
  );
}

export type FetchFeaturesResult =
  | { readonly outcome: "ok"; readonly features: readonly FeatureOutputDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /feature-registry/features` — `feature_registry:list`. The full catalog, optionally filtered. */
export async function fetchFeatures(query: {
  readonly lifecycle?: string;
  readonly category?: string;
} = {}): Promise<FetchFeaturesResult> {
  const params = new URLSearchParams();
  if (query.lifecycle !== undefined) params.set("lifecycle", query.lifecycle);
  if (query.category !== undefined) params.set("category", query.category);

  const result = await getAdminApi(
    `/api/v1/feature-registry/features?${params.toString()}`,
    isFeatureListDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", features: result.data.features };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

// ── Resolve ──────────────────────────────────────────────────────────────────────────────────────

export interface ResolvedFeatureDto extends FeatureOutputDto {
  /** True when the feature is usable (active or deprecated — not draft/removed). */
  readonly available: boolean;
}

function isResolvedFeatureDto(value: unknown): value is ResolvedFeatureDto {
  return (
    isFeatureOutputDto(value) && typeof (value as { available?: unknown }).available === "boolean"
  );
}

export type ResolveFeatureResult =
  | { readonly outcome: "ok"; readonly data: ResolvedFeatureDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /feature-registry/features/:key/resolve` — `feature_registry:resolve`. The read-only
 * resolution the EntitlementGuard itself uses: a feature's requirements plus whether it's
 * actually available. 404s (`NotFoundError`) when the key isn't registered.
 */
export async function resolveFeature(key: string): Promise<ResolveFeatureResult> {
  const result = await getAdminApi(
    `/api/v1/feature-registry/features/${encodeURIComponent(key)}/resolve`,
    isResolvedFeatureDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}

// ── Capability graph ─────────────────────────────────────────────────────────────────────────────

export interface CapabilityGraphFocusDto {
  readonly key: string;
  readonly dependencies: readonly string[];
  readonly transitiveDependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly impact: readonly string[];
}

function isCapabilityGraphFocusDto(value: unknown): value is CapabilityGraphFocusDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["key"] === "string" &&
    isStringArray(v["dependencies"]) &&
    isStringArray(v["transitiveDependencies"]) &&
    isStringArray(v["dependents"]) &&
    isStringArray(v["impact"])
  );
}

export interface CapabilityGraphDto {
  readonly nodes: readonly string[];
  readonly cycles: readonly (readonly string[])[];
  readonly acyclic: boolean;
  /** Present only when the query targets a specific feature key. */
  readonly focus?: CapabilityGraphFocusDto;
}

function isCapabilityGraphDto(value: unknown): value is CapabilityGraphDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isStringArray(v["nodes"])) return false;
  if (!Array.isArray(v["cycles"]) || !v["cycles"].every(isStringArray)) return false;
  if (typeof v["acyclic"] !== "boolean") return false;
  if (v["focus"] !== undefined && !isCapabilityGraphFocusDto(v["focus"])) return false;
  return true;
}

export type FetchCapabilityGraphResult =
  | { readonly outcome: "ok"; readonly data: CapabilityGraphDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /feature-registry/capability-graph` — `feature_registry:analyze_graph`. Cycle detection +
 * node count over the whole registry; pass `key` to also get that feature's direct/transitive
 * dependencies, dependents, and impact set.
 */
export async function fetchCapabilityGraph(key?: string): Promise<FetchCapabilityGraphResult> {
  const params = new URLSearchParams();
  if (key !== undefined && key.length > 0) params.set("key", key);

  const result = await getAdminApi(
    `/api/v1/feature-registry/capability-graph?${params.toString()}`,
    isCapabilityGraphDto,
  );
  return toSimpleResult(result);
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────────

export interface ValidationIssueDto {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly key: string;
  readonly message: string;
}

function isValidationIssueDto(value: unknown): value is ValidationIssueDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["code"] === "string" &&
    (v["severity"] === "error" || v["severity"] === "warning") &&
    typeof v["key"] === "string" &&
    typeof v["message"] === "string"
  );
}

export interface RegistryValidationReportDto {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssueDto[];
}

function isRegistryValidationReportDto(value: unknown): value is RegistryValidationReportDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { valid?: unknown }).valid === "boolean" &&
    Array.isArray((value as { issues?: unknown }).issues) &&
    (value as { issues: readonly unknown[] }).issues.every(isValidationIssueDto)
  );
}

export type FetchRegistryValidationResult =
  | { readonly outcome: "ok"; readonly data: RegistryValidationReportDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /feature-registry/validate` — `feature_registry:validate`. The deterministic
 * whole-registry validation report (duplicate keys, circular dependencies, missing dependencies,
 * invalid compatibility/constraints/cost, etc. — `FeatureRegistryValidator`). Errors make
 * `valid: false`; warnings don't.
 */
export async function fetchRegistryValidation(): Promise<FetchRegistryValidationResult> {
  const result = await getAdminApi(
    "/api/v1/feature-registry/validate",
    isRegistryValidationReportDto,
  );
  return toSimpleResult(result);
}

// ── Bundles ──────────────────────────────────────────────────────────────────────────────────────

export interface BundleOutputDto {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly featureKeys: readonly string[];
  readonly groups: readonly string[];
}

function isBundleOutputDto(value: unknown): value is BundleOutputDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["key"] === "string" &&
    typeof v["name"] === "string" &&
    typeof v["description"] === "string" &&
    typeof v["status"] === "string" &&
    isStringArray(v["featureKeys"]) &&
    isStringArray(v["groups"])
  );
}

interface BundleListDto {
  readonly bundles: readonly BundleOutputDto[];
}

function isBundleListDto(value: unknown): value is BundleListDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { bundles?: unknown }).bundles) &&
    (value as { bundles: readonly unknown[] }).bundles.every(isBundleOutputDto)
  );
}

export type FetchFeatureBundlesResult =
  | { readonly outcome: "ok"; readonly bundles: readonly BundleOutputDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /feature-registry/bundles` — `feature_registry:list_bundles`. The commercial bundle catalog. */
export async function fetchFeatureBundles(): Promise<FetchFeatureBundlesResult> {
  const result = await getAdminApi("/api/v1/feature-registry/bundles", isBundleListDto);
  if (result.outcome === "ok") return { outcome: "ok", bundles: result.data.bundles };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

// ── Capability edges (derived, not a backend endpoint) ──────────────────────────────────────────

export interface CapabilityEdgeDto {
  readonly from: string;
  readonly to: string;
  readonly relationship: "dependency" | "requires";
}

/**
 * Builds the plain from/to/relationship edge table the page renders for the capability graph, from
 * the already-fetched feature catalog — the exact same two sources
 * `CapabilityGraph.fromFeatures` (`services/feature-registry/src/domain/capability-graph.ts`)
 * folds into its internal adjacency list: each feature's declared `dependencies` and its
 * `compatibility.requires`. No backend endpoint returns a flat edge list, and this module does not
 * add a graph-drawing dependency to draw one — see the module doc's "No edges endpoint" note.
 */
export function deriveCapabilityEdges(
  features: readonly FeatureOutputDto[],
): readonly CapabilityEdgeDto[] {
  const edges: CapabilityEdgeDto[] = [];
  for (const feature of features) {
    for (const dependency of feature.dependencies) {
      edges.push({ from: feature.key, to: dependency.featureKey, relationship: "dependency" });
    }
    for (const requiredKey of feature.compatibility.requires) {
      edges.push({ from: feature.key, to: requiredKey, relationship: "requires" });
    }
  }
  return edges;
}
