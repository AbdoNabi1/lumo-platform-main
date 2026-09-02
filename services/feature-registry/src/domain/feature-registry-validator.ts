import { CapabilityGraph } from "./capability-graph";
import type { FeatureBundle } from "./feature-bundle";
import type { FeatureDefinition } from "./feature-definition";
import { FEATURE_CONSTRAINT_KEYS, isFeatureLifecyclePolicy } from "./value-objects/feature-spec";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly key: string;
  readonly message: string;
}

export interface RegistryValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

/**
 * FeatureRegistryValidator (P1.1.2 §7) — deterministic validation of the whole registry: duplicate feature ids,
 * circular dependencies/bundles, invalid compatibility, missing dependencies, invalid constraints, missing
 * documentation, invalid lifecycle, invalid cost profiles. Pure and order-independent (issues sorted). Errors
 * fail validity; warnings do not.
 */
export class FeatureRegistryValidator {
  validate(
    features: readonly FeatureDefinition[],
    bundles: readonly FeatureBundle[] = [],
  ): RegistryValidationReport {
    const issues: ValidationIssue[] = [];
    const keys = new Set<string>();
    const err = (code: string, key: string, message: string): void =>
      void issues.push({ code, severity: "error", key, message });
    const warn = (code: string, key: string, message: string): void =>
      void issues.push({ code, severity: "warning", key, message });

    // Duplicate feature ids.
    for (const f of features) {
      if (keys.has(f.key))
        err("duplicate_feature_id", f.key, `feature "${f.key}" is declared more than once`);
      keys.add(f.key);
    }

    for (const f of features) {
      const spec = f.effectiveSpec();
      // Missing dependencies + missing compatibility requires.
      for (const dep of spec.dependencies)
        if (!keys.has(dep.featureKey))
          err("missing_dependency", f.key, `depends on unknown feature "${dep.featureKey}"`);
      for (const req of spec.compatibility.requires)
        if (!keys.has(req)) err("missing_dependency", f.key, `requires unknown feature "${req}"`);
      // Invalid compatibility (requires ∩ conflictsWith).
      const conflicts = new Set(spec.compatibility.conflictsWith);
      for (const req of spec.compatibility.requires)
        if (conflicts.has(req))
          err("invalid_compatibility", f.key, `both requires and conflicts with "${req}"`);
      // Invalid constraints (negative below the -1 "unlimited" sentinel, or unknown key).
      for (const [k, v] of Object.entries(spec.constraints)) {
        if (v < -1) err("invalid_constraint", f.key, `constraint "${k}" has invalid value ${v}`);
        if (!FEATURE_CONSTRAINT_KEYS.includes(k))
          warn("invalid_constraint", f.key, `constraint "${k}" is not a canonical key`);
      }
      // Invalid lifecycle policy.
      // `spec.lifecyclePolicy`'s declared type is already the narrow FeatureLifecyclePolicy
      // union, so TS believes this branch is unreachable — but this validator's job is exactly
      // to catch registry data that violates its own declared type at runtime (e.g. loaded from
      // an external source without going through the VO factory). `: string` keeps the check —
      // and the message it produces — reachable per the type system.
      const lifecyclePolicy: string = spec.lifecyclePolicy;
      if (!isFeatureLifecyclePolicy(lifecyclePolicy))
        err("invalid_lifecycle", f.key, `lifecycle policy "${lifecyclePolicy}" is not recognised`);
      // Invalid cost profile (negative weights).
      const weights = [
        spec.cost.cpuWeight,
        spec.cost.memoryWeight,
        spec.cost.storageWeight,
        spec.cost.gpuWeight,
        spec.cost.networkWeight,
        spec.cost.aiWeight,
        spec.cost.executionWeight,
        spec.cost.estimatedCost,
      ];
      if (weights.some((w) => w < 0))
        err("invalid_cost_profile", f.key, `cost profile has a negative weight`);
      // Missing documentation on a generally-available feature.
      if (
        spec.lifecyclePolicy === "general_availability" &&
        spec.documentation.documentationUrl.length === 0
      )
        warn("missing_documentation", f.key, `GA feature has no documentation URL`);
    }

    // Circular dependencies (feature graph).
    const graph = CapabilityGraph.fromFeatures(
      features.map((f) => {
        const s = f.effectiveSpec();
        return { key: f.key, dependencies: s.dependencies, requires: s.compatibility.requires };
      }),
    );
    for (const cycle of graph.detectCycles())
      err("circular_dependency", cycle[0] ?? "", `circular dependency: ${cycle.join(" -> ")}`);

    // Bundles: referenced features must exist; a bundle whose members form a cycle is flagged.
    for (const b of bundles) {
      for (const fk of b.featureKeys)
        if (!keys.has(fk))
          err("missing_dependency", b.key, `bundle references unknown feature "${fk}"`);
      const memberCycle = graph
        .detectCycles()
        .some((cycle) => cycle.some((k) => b.featureKeys.includes(k)));
      if (memberCycle)
        err(
          "circular_bundle",
          b.key,
          `bundle "${b.key}" includes features with a circular dependency`,
        );
    }

    issues.sort((a, b) => (a.code + a.key).localeCompare(b.code + b.key));
    return { valid: issues.every((i) => i.severity !== "error"), issues };
  }
}
