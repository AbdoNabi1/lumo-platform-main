import { ok, type Result } from "@platform/types";
import type { BusinessRuleError, NotFoundError } from "@platform/utils";
import { isCalculatedMetric, isMetricDefinition } from "../domain/semantic-model";
import { MetricDependencyResolver } from "../resolvers/metric-dependency-resolver";
import type { SemanticRegistry } from "../registry/semantic-registry";
import type { QueryPlan, SemanticQuery } from "./semantic-query";

/**
 * Resolves a {@link SemanticQuery}'s requested metric ids into a full {@link QueryPlan} —
 * transitively including every base metric a calculated metric depends on, in the dependency
 * order `MetricDependencyResolver` proves is safe to evaluate in.
 */
export const SemanticQueryPlanner = {
  plan(
    registry: SemanticRegistry,
    query: SemanticQuery,
  ): Result<QueryPlan, NotFoundError | BusinessRuleError> {
    const resolved = MetricDependencyResolver.resolveOrder(registry, query.metricIds);
    if (!resolved.ok) return resolved;

    const evaluationOrder = resolved.value;
    return ok({
      evaluationOrder,
      baseMetrics: evaluationOrder.filter(isMetricDefinition),
      calculatedMetrics: evaluationOrder.filter(isCalculatedMetric),
    });
  },
} as const;
