/**
 * Platform-wide KPIs (ADR-0018 Sprint-5.6 addendum §J) — MRR/ARR/revenue/tenant counts/trials/churn;
 * AI/storage/API usage; marketplace revenue; failed payments/jobs, error rate, merchant health.
 * Owns no business data of its own — a pure projection over Tenancy/Licensing/Usage/System events.
 */
export interface PlatformKpis {
  readonly mrr: number;
  readonly arr: number;
  readonly revenue: number;
  readonly tenantCount: number;
  readonly trialCount: number;
  readonly churnedCount: number;
  readonly aiUsage: number;
  readonly storageUsage: number;
  readonly apiUsage: number;
  readonly marketplaceRevenue: number;
  readonly failedPayments: number;
  readonly failedJobs: number;
  readonly errorRate: number;
  readonly merchantHealthScore: number;
}

/** The zero-state KPI snapshot — every projection starts here. */
export function emptyPlatformKpis(): PlatformKpis {
  return {
    mrr: 0,
    arr: 0,
    revenue: 0,
    tenantCount: 0,
    trialCount: 0,
    churnedCount: 0,
    aiUsage: 0,
    storageUsage: 0,
    apiUsage: 0,
    marketplaceRevenue: 0,
    failedPayments: 0,
    failedJobs: 0,
    errorRate: 0,
    merchantHealthScore: 100,
  };
}
