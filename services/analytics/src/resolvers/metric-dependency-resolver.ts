import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, NotFoundError } from "@platform/utils";
import { collectReferencedMetricIds } from "../domain/value-objects/metric-expression";
import { isCalculatedMetric, type Metric } from "../domain/semantic-model";
import type { SemanticRegistry } from "../registry/semantic-registry";

type VisitState = "visiting" | "done";

/**
 * Resolves the requested metric ids (and everything they transitively depend on) into a single
 * evaluation order — every metric a `CalculatedMetric` references appears before it. Base metrics
 * have no dependencies and always sort first among their own subtree. Missing references and
 * dependency cycles both fail closed rather than partially evaluating.
 */
export const MetricDependencyResolver = {
  resolveOrder(
    registry: SemanticRegistry,
    metricIds: readonly string[],
  ): Result<readonly Metric[], NotFoundError | BusinessRuleError> {
    const order: Metric[] = [];
    const seen = new Set<string>();
    const state = new Map<string, VisitState>();

    const visit = (
      id: string,
      path: readonly string[],
    ): Result<void, NotFoundError | BusinessRuleError> => {
      if (state.get(id) === "done") return ok(undefined);
      if (state.get(id) === "visiting") {
        return err(
          new BusinessRuleError(`Cyclic metric dependency: ${[...path, id].join(" -> ")}`),
        );
      }
      const metric = registry.metrics.get(id);
      if (!metric) {
        return err(new NotFoundError(`Metric not found: ${id}`));
      }
      state.set(id, "visiting");

      if (isCalculatedMetric(metric)) {
        for (const dependencyId of collectReferencedMetricIds(metric.expression)) {
          const result = visit(dependencyId, [...path, id]);
          if (!result.ok) return result;
        }
      }

      state.set(id, "done");
      if (!seen.has(id)) {
        seen.add(id);
        order.push(metric);
      }
      return ok(undefined);
    };

    for (const id of metricIds) {
      const result = visit(id, []);
      if (!result.ok) return result;
    }

    return ok(order);
  },
} as const;
