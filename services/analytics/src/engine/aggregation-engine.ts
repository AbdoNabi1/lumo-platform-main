import type { Aggregation } from "../domain/value-objects/aggregation";

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * The one aggregation implementation in Analytics — `AggregationEngine` runs over rows already
 * fetched by an {@link AnalyticsReadStore} (app-tier aggregation; see the Core Engine's decision
 * log). Non-numeric/missing field values are excluded from `sum`/`avg`/`min`/`max` (never coerced
 * to `0`, which would silently understate a real value); an empty numeric set resolves to `0`.
 */
export const AggregationEngine = {
  aggregate(
    rows: readonly Record<string, unknown>[],
    aggregation: Aggregation,
    field: string,
  ): number {
    switch (aggregation) {
      case "count":
        return rows.length;
      case "count_distinct":
        return new Set(
          rows.map((row) => row[field]).filter((value) => value !== undefined && value !== null),
        ).size;
      case "sum": {
        const numbers = rows
          .map((row) => toNumber(row[field]))
          .filter((n): n is number => n !== undefined);
        return numbers.reduce((sum, n) => sum + n, 0);
      }
      case "avg": {
        const numbers = rows
          .map((row) => toNumber(row[field]))
          .filter((n): n is number => n !== undefined);
        return numbers.length === 0 ? 0 : numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
      }
      case "min": {
        const numbers = rows
          .map((row) => toNumber(row[field]))
          .filter((n): n is number => n !== undefined);
        return numbers.length === 0 ? 0 : Math.min(...numbers);
      }
      case "max": {
        const numbers = rows
          .map((row) => toNumber(row[field]))
          .filter((n): n is number => n !== undefined);
        return numbers.length === 0 ? 0 : Math.max(...numbers);
      }
    }
  },
} as const;
