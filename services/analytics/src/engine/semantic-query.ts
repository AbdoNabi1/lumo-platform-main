import type { CalculatedMetric, MetricDefinition } from "../domain/semantic-model";

/** A request: which metrics to compute, optionally sliced by dimensions and exact-match filters. */
export interface SemanticQuery {
  readonly metricIds: readonly string[];
  readonly dimensionIds?: readonly string[];
  /** Exact-match filters, keyed by dimension canonical id. */
  readonly filters?: Readonly<Record<string, string>>;
}

/** `SemanticQueryPlanner`'s output: the requested metrics resolved into evaluation order. */
export interface QueryPlan {
  readonly baseMetrics: readonly MetricDefinition[];
  readonly calculatedMetrics: readonly CalculatedMetric[];
  /** `baseMetrics` followed by `calculatedMetrics`, interleaved in true dependency order. */
  readonly evaluationOrder: readonly (MetricDefinition | CalculatedMetric)[];
}
