/**
 * The frozen snapshot a `PlanVersion` carries once published (ADR-0018 Sprint-5.5 addendum §A) —
 * `PlanLimits` + `featureEntitlements[]` + pricing (base price, billing cycle, trial, and
 * per-credit allowances). `PlanSections` (Sprint-5.6) projects this into explicit typed sections.
 */
export interface PlanLimits {
  readonly maxProducts?: number;
  readonly maxOrders?: number;
  readonly maxStaff?: number;
  readonly maxAiCredits?: number;
  readonly maxIntegrations?: number;
  readonly maxWorkflows?: number;
  readonly maxExperiments?: number;
}

export type BillingCycle = "monthly" | "annual";

export interface PlanPricing {
  readonly basePrice: number;
  readonly billingCycle: BillingCycle;
  readonly trialDays?: number;
  readonly creditAllowances: Readonly<Record<string, number>>;
}

export interface PlanSpec {
  readonly limits: PlanLimits;
  readonly featureEntitlements: readonly string[];
  readonly pricing: PlanPricing;
}
