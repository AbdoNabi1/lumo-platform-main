import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

/** The single, closed set of aggregation functions `AggregationEngine` implements. */
export const AGGREGATIONS = ["sum", "avg", "count", "count_distinct", "min", "max"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export function defineAggregation(value: string): Result<Aggregation, ValidationError> {
  if ((AGGREGATIONS as readonly string[]).includes(value)) {
    return ok(value as Aggregation);
  }
  return err(
    new ValidationError("Invalid aggregation", [
      { field: "aggregation", message: `must be one of: ${AGGREGATIONS.join(", ")}` },
    ]),
  );
}

/** The unit a metric's numeric value is expressed in — display/formatting metadata only. */
export const METRIC_UNITS = ["currency", "percentage", "count", "ratio", "days"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export function defineMetricUnit(value: string): Result<MetricUnit, ValidationError> {
  if ((METRIC_UNITS as readonly string[]).includes(value)) {
    return ok(value as MetricUnit);
  }
  return err(
    new ValidationError("Invalid metric unit", [
      { field: "unit", message: `must be one of: ${METRIC_UNITS.join(", ")}` },
    ]),
  );
}
