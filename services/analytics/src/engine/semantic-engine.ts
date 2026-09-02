import { ok, type Result } from "@platform/types";
import type { BusinessRuleError, NotFoundError, ValidationError } from "@platform/utils";
import type { AnalyticsReadStore } from "../domain/ports";
import { isCalculatedMetric } from "../domain/semantic-model";
import { DimensionResolver } from "../resolvers/dimension-resolver";
import type { SemanticRegistry } from "../registry/semantic-registry";
import { AggregationEngine } from "./aggregation-engine";
import { ExpressionEvaluator } from "./expression-evaluator";
import { QueryCompiler, type ReadModelQuery } from "./query-compiler";
import type { QueryPlan, SemanticQuery } from "./semantic-query";
import { SemanticQueryPlanner } from "./semantic-query-planner";

const GLOBAL_GROUP = "__all__";

export interface SemanticResultRow {
  readonly dimensions: Readonly<Record<string, string>>;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface SemanticQueryResult {
  readonly rows: readonly SemanticResultRow[];
}

type FetchedRows = ReadonlyMap<string, readonly Record<string, unknown>[]>;

/**
 * Orchestrates one query end to end: plan (dependency order) -> compile (one read per read
 * model) -> read-only fetch -> aggregate each base metric -> join base-metric values across read
 * models on the dimension key -> evaluate calculated metrics in dependency order. Without
 * requested dimensions, every fetched row is one global group (a scalar total per metric); with
 * requested dimensions, rows are grouped by each read model's configured join key first.
 */
export const SemanticEngine = {
  async execute(
    registry: SemanticRegistry,
    store: AnalyticsReadStore,
    query: SemanticQuery,
  ): Promise<Result<SemanticQueryResult, NotFoundError | BusinessRuleError | ValidationError>> {
    const planned = SemanticQueryPlanner.plan(registry, query);
    if (!planned.ok) return planned;

    const compiled = QueryCompiler.compile(registry, planned.value, query);
    if (!compiled.ok) return compiled;

    const fetched: Map<string, readonly Record<string, unknown>[]> = new Map();
    for (const rmq of compiled.value) {
      fetched.set(
        rmq.readModelId,
        await store.fetch(rmq.readModelId, { fields: rmq.fields, filters: rmq.filters }),
      );
    }

    const grouped = groupBaseMetricValues(compiled.value, fetched, query.dimensionIds ?? []);
    const dimensionValues = resolveDimensionValues(
      registry,
      compiled.value,
      fetched,
      query.dimensionIds ?? [],
    );
    if (!dimensionValues.ok) return dimensionValues;

    const groupKeys =
      query.dimensionIds && query.dimensionIds.length > 0 ? [...grouped.keys()] : [GLOBAL_GROUP];

    const rows: SemanticResultRow[] = [];
    for (const groupKey of groupKeys) {
      const baseValues = grouped.get(groupKey) ?? new Map<string, number>();
      const evaluated = evaluate(planned.value, baseValues);
      const metrics: Record<string, number> = {};
      for (const metricId of query.metricIds) metrics[metricId] = evaluated.get(metricId) ?? 0;
      rows.push({ dimensions: dimensionValues.value.get(groupKey) ?? {}, metrics });
    }

    return ok({ rows });
  },
} as const;

function evaluate(plan: QueryPlan, baseValues: ReadonlyMap<string, number>): Map<string, number> {
  const values = new Map(baseValues);
  for (const metric of plan.evaluationOrder) {
    if (isCalculatedMetric(metric)) {
      values.set(metric.id.value, ExpressionEvaluator.evaluate(metric.expression, values));
    }
  }
  return values;
}

/** Per read model, groups fetched rows by the join key (or one global group), then aggregates each measure. */
function groupBaseMetricValues(
  queries: readonly ReadModelQuery[],
  fetched: FetchedRows,
  dimensionIds: readonly string[],
): Map<string, Map<string, number>> {
  const byGroup = new Map<string, Map<string, number>>();

  for (const rmq of queries) {
    const rows = fetched.get(rmq.readModelId) ?? [];
    const buckets =
      dimensionIds.length > 0
        ? groupRowsByField(rows, rmq.dimensionKey)
        : new Map([[GLOBAL_GROUP, rows]]);

    for (const [groupKey, groupRows] of buckets) {
      const values = byGroup.get(groupKey) ?? new Map<string, number>();
      for (const measure of rmq.measures) {
        values.set(
          measure.metricId,
          AggregationEngine.aggregate(groupRows, measure.aggregation, measure.physicalField),
        );
      }
      byGroup.set(groupKey, values);
    }
  }

  return byGroup;
}

/** Resolves each requested dimension's display value per group (first row's value wins within a group). */
function resolveDimensionValues(
  registry: SemanticRegistry,
  queries: readonly ReadModelQuery[],
  fetched: FetchedRows,
  dimensionIds: readonly string[],
): Result<Map<string, Record<string, string>>, NotFoundError> {
  const byGroup = new Map<string, Record<string, string>>();
  if (dimensionIds.length === 0) return ok(byGroup);

  for (const dimensionId of dimensionIds) {
    const resolved = DimensionResolver.resolve(registry, dimensionId);
    if (!resolved.ok) return resolved;
    const readModelId = resolved.value.binding.readModelId.value;
    const rmq = queries.find((q) => q.readModelId === readModelId);
    if (!rmq) continue;
    const rows = fetched.get(readModelId) ?? [];
    const buckets = groupRowsByField(rows, rmq.dimensionKey);
    for (const [groupKey, groupRows] of buckets) {
      const value = groupRows[0]?.[resolved.value.binding.physicalField];
      if (value === undefined) continue;
      const existing = byGroup.get(groupKey) ?? {};
      byGroup.set(groupKey, { ...existing, [dimensionId]: toGroupKey(value) });
    }
  }

  return ok(byGroup);
}

/**
 * A dimension/group-by value's own display or grouping key. Guards against object-valued fields
 * all collapsing to the same "[object Object]" string (Object.prototype.toString), which would
 * silently merge distinct groups.
 */
function toGroupKey(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function groupRowsByField(
  rows: readonly Record<string, unknown>[],
  field: string,
): Map<string, readonly Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = toGroupKey(row[field] ?? "");
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return groups;
}
