/** Outbound seam to the Analytics semantic engine — Reporting never runs a business query directly. */
export interface AnalyticsQueryPort {
  run(
    metrics: readonly string[],
    dimensions: readonly string[],
    filters: readonly {
      readonly field: string;
      readonly operator: string;
      readonly value: unknown;
    }[],
  ): Promise<unknown>;
}
