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

/**
 * MONEY UNIT CONVENTION (WP-14): `basePriceMinor` is an INTEGER count of `currency`'s minor units —
 * the convention `Money` / `payments`' `amountMinor` / `Invoice` use — so the price a renewal
 * charges is exact, and a version is self-describing (price + currency travel together, immutably).
 * `currency` `"XXX"` (ISO 4217 "no currency") marks a version migrated from before this convention
 * existed (see migration `20260924000000_wp14_platform_plans`): it is loadable and entitles, but it
 * is NOT billable — `BillSubscriptionRenewal` refuses it rather than guess a currency.
 */
export interface PlanPricing {
  readonly basePriceMinor: number;
  readonly currency: string;
  readonly billingCycle: BillingCycle;
  readonly trialDays?: number;
  readonly creditAllowances: Readonly<Record<string, number>>;
}

export interface PlanSpec {
  readonly limits: PlanLimits;
  readonly featureEntitlements: readonly string[];
  readonly pricing: PlanPricing;
}
