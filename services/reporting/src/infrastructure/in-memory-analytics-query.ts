import type { AnalyticsQueryPort } from "../application/ports";

/**
 * Offline in-memory stub adapter for `AnalyticsQueryPort`. Production swaps this for a real adapter
 * onto `@platform/analytics`'s semantic engine at the composition root (deferred, per the report's
 * own G-39 note) — unchanged interface.
 */
export class InMemoryAnalyticsQuery implements AnalyticsQueryPort {
  async run(
    metrics: readonly string[],
    dimensions: readonly string[],
    filters: readonly {
      readonly field: string;
      readonly operator: string;
      readonly value: unknown;
    }[],
  ): Promise<unknown> {
    return { metrics, dimensions, filters, rows: [] };
  }
}
