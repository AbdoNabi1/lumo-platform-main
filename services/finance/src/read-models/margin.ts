/**
 * Read-only projection of the raw amounts Analytics needs to derive margin — carries revenue and
 * COGS facts only. **No percentage is computed here**; margin itself is an Analytics
 * `MetricDefinition` resolved over this read model (D-064).
 */
export interface MarginReadModel {
  readonly period: string;
  readonly currency: string;
  readonly revenueMinor: number;
  readonly cogsMinor: number;
}

export function projectMargin(
  revenueMinor: number,
  cogsMinor: number,
  period: string,
  currency: string,
): MarginReadModel {
  return { period, currency, revenueMinor, cogsMinor };
}
