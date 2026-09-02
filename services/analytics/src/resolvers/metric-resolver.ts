import { err, ok, type Result } from "@platform/types";
import { NotFoundError } from "@platform/utils";
import type { Metric } from "../domain/semantic-model";
import type { SemanticRegistry } from "../registry/semantic-registry";

export const MetricResolver = {
  resolve(registry: SemanticRegistry, metricId: string): Result<Metric, NotFoundError> {
    const metric = registry.metrics.get(metricId);
    return metric ? ok(metric) : err(new NotFoundError(`Metric not found: ${metricId}`));
  },
} as const;
