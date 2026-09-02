export { wireAnalytics, type WiredAnalytics } from "./composition";
export { AnalyticsConsoleController } from "./interfaces/analytics-console.controller";
export * from "./domain/value-objects/canonical-id";
export * from "./domain/value-objects/aggregation";
export * from "./domain/value-objects/metric-expression";
export { SemanticBinding } from "./domain/semantic-binding";
export { ReadModelDescriptor } from "./domain/read-model-descriptor";
export {
  Measure,
  MetricDefinition,
  CalculatedMetric,
  isCalculatedMetric,
} from "./domain/semantic-model";
export type { Metric } from "./domain/semantic-model";
export { DimensionDefinition } from "./domain/dimension-definition";
export type { AnalyticsReadStore, AnalyticsReadStoreFetchParams } from "./domain/ports";

export { MetricCatalog } from "./registry/metric-catalog";
export { DimensionCatalog } from "./registry/dimension-catalog";
export { ReadModelRegistry } from "./registry/read-model-registry";
export { SemanticRegistry } from "./registry/semantic-registry";

export { MetricResolver } from "./resolvers/metric-resolver";
export { DimensionResolver } from "./resolvers/dimension-resolver";
export { MetricDependencyResolver } from "./resolvers/metric-dependency-resolver";

export { ExpressionEvaluator } from "./engine/expression-evaluator";
export { AggregationEngine } from "./engine/aggregation-engine";
export { SemanticValidation } from "./engine/semantic-validation";
export type { SemanticQuery, QueryPlan } from "./engine/semantic-query";
export { SemanticQueryPlanner } from "./engine/semantic-query-planner";
export { QueryCompiler } from "./engine/query-compiler";
export type { ReadModelQuery, CompiledMeasure } from "./engine/query-compiler";
export { SemanticEngine } from "./engine/semantic-engine";
export type { SemanticQueryResult, SemanticResultRow } from "./engine/semantic-engine";

export { InMemoryAnalyticsReadStore } from "./infrastructure/in-memory-analytics-read-store";
export { ClickHouseAnalyticsReadStore } from "./infrastructure/clickhouse-analytics-read-store";
export type { ClickHouseAnalyticsReadStoreDeps } from "./infrastructure/clickhouse-analytics-read-store";
export { registerFinanceSemantics } from "./infrastructure/finance-semantics";
