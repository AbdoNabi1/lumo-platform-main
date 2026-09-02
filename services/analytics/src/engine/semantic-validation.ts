import { ok, err, type Result } from "@platform/types";
import { ValidationError, type FieldIssue } from "@platform/utils";
import { collectReferencedMetricIds } from "../domain/value-objects/metric-expression";
import { isCalculatedMetric, type Metric } from "../domain/semantic-model";
import type { SemanticBinding } from "../domain/semantic-binding";
import type { SemanticRegistry } from "../registry/semantic-registry";

/**
 * Whole-registry, fail-closed validation: every binding must point at a registered read model
 * and a field it actually declares (shape), and every `CalculatedMetric` must reference only
 * metric ids that exist somewhere in the catalog (coverage). Collects every issue found rather
 * than stopping at the first, mirroring `Guard.combine`'s aggregation style.
 */
export const SemanticValidation = {
  validateRegistry(registry: SemanticRegistry): Result<void, ValidationError> {
    const issues: FieldIssue[] = [];

    const checkBinding = (field: string, binding: SemanticBinding): void => {
      const readModel = registry.readModels.get(binding.readModelId.value);
      if (!readModel) {
        issues.push({ field, message: `unknown read model: ${binding.readModelId.value}` });
        return;
      }
      if (!readModel.hasField(binding.physicalField)) {
        issues.push({
          field,
          message: `read model ${binding.readModelId.value} has no field ${binding.physicalField}`,
        });
      }
    };

    const checkMetric = (metric: Metric): void => {
      if (isCalculatedMetric(metric)) {
        for (const refId of collectReferencedMetricIds(metric.expression)) {
          if (!registry.metrics.has(refId)) {
            issues.push({
              field: `metric:${metric.id.value}`,
              message: `references unknown metric: ${refId}`,
            });
          }
        }
      } else {
        checkBinding(`metric:${metric.id.value}`, metric.measure.binding);
      }
    };

    for (const metric of registry.metrics.list()) checkMetric(metric);
    for (const dimension of registry.dimensions.list()) {
      checkBinding(`dimension:${dimension.id.value}`, dimension.binding);
    }

    return issues.length === 0
      ? ok(undefined)
      : err(new ValidationError("Semantic registry validation failed", issues));
  },
} as const;
