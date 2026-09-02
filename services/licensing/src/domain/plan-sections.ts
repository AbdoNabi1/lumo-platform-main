import type { PlanSpec } from "./value-objects/plan-spec";

export type PlanSectionName =
  | "pricing"
  | "features"
  | "limits"
  | "usage"
  | "storage"
  | "automation"
  | "marketplace"
  | "ai"
  | "branding"
  | "support"
  | "sla";

const SECTION_NAMES: readonly PlanSectionName[] = [
  "pricing",
  "features",
  "limits",
  "usage",
  "storage",
  "automation",
  "marketplace",
  "ai",
  "branding",
  "support",
  "sla",
];

/**
 * A `PlanVersion` projected into explicit, comparable domain sections (ADR-0018 Sprint-5.6
 * addendum §G) — derived from the existing `PlanSpec` snapshot, no persistence change of its own.
 * Independent per-section version pointers are a later refinement (deferred, per the ADR).
 */
export class PlanSections {
  private readonly sections: Readonly<Record<PlanSectionName, unknown>>;

  private constructor(sections: Readonly<Record<PlanSectionName, unknown>>) {
    this.sections = sections;
  }

  /** Projects a `PlanSpec` into the 11 named sections. */
  static project(spec: PlanSpec): PlanSections {
    return new PlanSections({
      pricing: spec.pricing,
      features: spec.featureEntitlements,
      limits: spec.limits,
      usage: spec.pricing.creditAllowances,
      storage: { storageBytes: spec.pricing.creditAllowances.storage ?? 0 },
      automation: { maxWorkflows: spec.limits.maxWorkflows },
      marketplace: { marketplaceCredits: spec.pricing.creditAllowances.marketplace_credits ?? 0 },
      ai: { aiCredits: spec.pricing.creditAllowances.ai_credits ?? spec.limits.maxAiCredits ?? 0 },
      branding: {},
      support: {},
      sla: {},
    });
  }

  section(name: PlanSectionName): unknown {
    return this.sections[name];
  }

  /** Section-by-section diff — `true` where the two projections differ (deep, JSON-stable). */
  diff(other: PlanSections): Readonly<Record<PlanSectionName, boolean>> {
    const result = {} as Record<PlanSectionName, boolean>;
    for (const name of SECTION_NAMES) {
      result[name] = JSON.stringify(this.sections[name]) !== JSON.stringify(other.sections[name]);
    }
    return result;
  }
}
