import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, NotFoundError } from "@platform/utils";
import type { Aggregation } from "../domain/value-objects/aggregation";
import { DimensionResolver } from "../resolvers/dimension-resolver";
import type { SemanticRegistry } from "../registry/semantic-registry";
import type { QueryPlan, SemanticQuery } from "./semantic-query";

export interface CompiledMeasure {
  readonly metricId: string;
  readonly aggregation: Aggregation;
  readonly physicalField: string;
}

/** One read query per read model — never per metric, so a read model is fetched at most once. */
export interface ReadModelQuery {
  readonly readModelId: string;
  readonly dimensionKey: string;
  readonly fields: readonly string[];
  readonly filters?: Readonly<Record<string, string>>;
  readonly measures: readonly CompiledMeasure[];
  readonly dimensionFields: readonly string[];
}

interface Group {
  readonly measures: CompiledMeasure[];
  readonly dimensionFields: Set<string>;
  readonly filters: Record<string, string>;
}

/**
 * Compiles a resolved {@link QueryPlan} + the original {@link SemanticQuery}'s dimensions/filters
 * into one {@link ReadModelQuery} per read model touched. Canonical ids are resolved to physical
 * field names exclusively via registered bindings — no field name is ever read from user input or
 * string-concatenated into a query, so there is no SQL/identifier-injection surface here.
 */
export const QueryCompiler = {
  compile(
    registry: SemanticRegistry,
    plan: QueryPlan,
    query: SemanticQuery,
  ): Result<readonly ReadModelQuery[], NotFoundError | BusinessRuleError> {
    const groups = new Map<string, Group>();
    const groupFor = (readModelId: string): Group => {
      const existing = groups.get(readModelId);
      if (existing) return existing;
      const created: Group = { measures: [], dimensionFields: new Set(), filters: {} };
      groups.set(readModelId, created);
      return created;
    };

    for (const metric of plan.baseMetrics) {
      const binding = metric.measure.binding;
      groupFor(binding.readModelId.value).measures.push({
        metricId: metric.id.value,
        aggregation: metric.measure.aggregation,
        physicalField: binding.physicalField,
      });
    }

    for (const dimensionId of query.dimensionIds ?? []) {
      const resolved = DimensionResolver.resolve(registry, dimensionId);
      if (!resolved.ok) return resolved;
      groupFor(resolved.value.binding.readModelId.value).dimensionFields.add(
        resolved.value.binding.physicalField,
      );
    }

    for (const [dimensionId, value] of Object.entries(query.filters ?? {})) {
      const resolved = DimensionResolver.resolve(registry, dimensionId);
      if (!resolved.ok) return resolved;
      const group = groups.get(resolved.value.binding.readModelId.value);
      if (!group) {
        return err(
          new BusinessRuleError(
            `Filter dimension ${dimensionId} belongs to a read model not otherwise part of this query`,
          ),
        );
      }
      group.filters[resolved.value.binding.physicalField] = value;
    }

    const queries: ReadModelQuery[] = [];
    for (const [readModelId, group] of groups) {
      const readModel = registry.readModels.get(readModelId);
      if (!readModel) {
        return err(new NotFoundError(`Read model not found: ${readModelId}`));
      }
      const dimensionFields = [...group.dimensionFields];
      const fields = [
        ...new Set([
          ...group.measures.map((m) => m.physicalField),
          ...dimensionFields,
          readModel.dimensionKey,
        ]),
      ];
      queries.push({
        readModelId,
        dimensionKey: readModel.dimensionKey,
        fields,
        filters: Object.keys(group.filters).length > 0 ? group.filters : undefined,
        measures: group.measures,
        dimensionFields,
      });
    }

    return ok(queries);
  },
} as const;
