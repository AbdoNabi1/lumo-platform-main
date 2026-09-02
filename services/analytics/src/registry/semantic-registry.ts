import { DimensionCatalog } from "./dimension-catalog";
import { MetricCatalog } from "./metric-catalog";
import { ReadModelRegistry } from "./read-model-registry";

/**
 * The single source of truth composing {@link MetricCatalog}, {@link DimensionCatalog}, and
 * {@link ReadModelRegistry} — the one object every resolver, planner, and validator is handed.
 * A fresh registry is empty; contexts populate it (e.g. `registerFinanceSemantics`).
 */
export class SemanticRegistry {
  readonly metrics = new MetricCatalog();
  readonly dimensions = new DimensionCatalog();
  readonly readModels = new ReadModelRegistry();
}
