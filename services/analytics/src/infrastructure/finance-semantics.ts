import type { Result } from "@platform/types";
import type { ValidationError } from "@platform/utils";
import { CanonicalId } from "../domain/value-objects/canonical-id";
import { SemanticBinding } from "../domain/semantic-binding";
import { ReadModelDescriptor } from "../domain/read-model-descriptor";
import { DimensionDefinition } from "../domain/dimension-definition";
import { CalculatedMetric, Measure, MetricDefinition } from "../domain/semantic-model";
import { divideExpr, refExpr, subtractExpr } from "../domain/value-objects/metric-expression";
import type { SemanticRegistry } from "../registry/semantic-registry";

/** Registration inputs are hardcoded, known-valid literals — a failure here is a programming bug. */
function unwrap<T>(result: Result<T, ValidationError>): T {
  if (!result.ok) {
    throw new Error(`registerFinanceSemantics: invalid definition — ${result.error.message}`);
  }
  return result.value;
}

function id(value: string): CanonicalId {
  return unwrap(CanonicalId.define(value));
}

function readModel(
  idValue: string,
  fields: readonly string[],
  dimensionKey: string,
): ReadModelDescriptor {
  return unwrap(ReadModelDescriptor.define(id(idValue), fields, dimensionKey));
}

function binding(readModelId: CanonicalId, physicalField: string): SemanticBinding {
  return unwrap(SemanticBinding.define(readModelId, physicalField));
}

function baseMetric(
  idValue: string,
  description: string,
  readModelId: CanonicalId,
  physicalField: string,
): MetricDefinition {
  const measure = unwrap(Measure.define(id(idValue), "sum", binding(readModelId, physicalField)));
  return unwrap(MetricDefinition.define(id(idValue), "currency", description, measure));
}

/**
 * Registers Finance's canonical metrics/dimensions/read models into `registry` — the *only*
 * place Finance's read-model shapes are named. Bound to `services/finance`'s own read-model
 * fields (`period`/`grossProfitMinor`/…) by string only; Analytics imports nothing from
 * `@platform/finance`. Base metrics per read model; margins/EBIT are `CalculatedMetric`s so the
 * ratio math lives once, here, never inside Finance (D-064).
 */
export function registerFinanceSemantics(registry: SemanticRegistry): void {
  const revenueRm = readModel(
    "finance.revenue",
    ["period", "currency", "grossMinor", "refundsMinor", "netMinor"],
    "period",
  );
  const profitRm = readModel(
    "finance.profit",
    [
      "period",
      "currency",
      "revenueMinor",
      "cogsMinor",
      "expensesMinor",
      "grossProfitMinor",
      "netProfitMinor",
    ],
    "period",
  );
  const cogsRm = readModel("finance.cogs", ["period", "currency", "totalMinor"], "period");
  const expenseRm = readModel("finance.expense", ["period", "currency", "totalMinor"], "period");
  const cashFlowRm = readModel("finance.cash_flow", ["period", "currency", "netMinor"], "period");
  const taxRm = readModel(
    "finance.tax",
    ["period", "currency", "jurisdiction", "baseMinor", "taxMinor"],
    "period",
  );
  const inventoryCostRm = readModel(
    "finance.inventory_cost",
    ["productRef", "currency", "totalMinor", "effectiveAt"],
    "effectiveAt",
  );

  for (const rm of [revenueRm, profitRm, cogsRm, expenseRm, cashFlowRm, taxRm, inventoryCostRm]) {
    registry.readModels.register(rm);
  }

  registry.dimensions.register(
    unwrap(
      DimensionDefinition.define(id("finance.period"), "Period", binding(revenueRm.id, "period")),
    ),
  );

  const revenue = baseMetric(
    "finance.revenue",
    "Net revenue for the period",
    revenueRm.id,
    "netMinor",
  );
  const grossProfit = baseMetric(
    "finance.gross_profit",
    "Gross profit for the period",
    profitRm.id,
    "grossProfitMinor",
  );
  const netProfit = baseMetric(
    "finance.net_profit",
    "Net profit for the period",
    profitRm.id,
    "netProfitMinor",
  );
  const cogs = baseMetric(
    "finance.cogs",
    "Cost of goods sold for the period",
    cogsRm.id,
    "totalMinor",
  );
  const expenses = baseMetric(
    "finance.expenses",
    "Total expenses for the period",
    expenseRm.id,
    "totalMinor",
  );
  const cashFlow = baseMetric(
    "finance.cash_flow",
    "Net cash flow for the period",
    cashFlowRm.id,
    "netMinor",
  );
  const tax = baseMetric("finance.tax", "Tax owed for the period", taxRm.id, "taxMinor");
  const inventoryValue = baseMetric(
    "finance.inventory_value",
    "Inventory cost value as of the snapshot",
    inventoryCostRm.id,
    "totalMinor",
  );

  for (const metric of [
    revenue,
    grossProfit,
    netProfit,
    cogs,
    expenses,
    cashFlow,
    tax,
    inventoryValue,
  ]) {
    registry.metrics.register(metric);
  }

  // EBIT (= operating income): revenue - cogs - expenses. Calculated, never a raw read (D-064
  // decision 1) — Contribution Margin/EBITDA deliberately omitted (decision 4: no D&A read model).
  const operatingProfit = unwrap(
    CalculatedMetric.define(
      id("finance.operating_profit"),
      "currency",
      "EBIT: revenue less COGS and expenses",
      subtractExpr(
        subtractExpr(refExpr("finance.revenue"), refExpr("finance.cogs")),
        refExpr("finance.expenses"),
      ),
    ),
  );
  registry.metrics.register(operatingProfit);

  const grossMargin = unwrap(
    CalculatedMetric.define(
      id("finance.gross_margin"),
      "ratio",
      "Gross profit / revenue",
      divideExpr(refExpr("finance.gross_profit"), refExpr("finance.revenue")),
    ),
  );
  const operatingMargin = unwrap(
    CalculatedMetric.define(
      id("finance.operating_margin"),
      "ratio",
      "Operating profit (EBIT) / revenue",
      divideExpr(refExpr("finance.operating_profit"), refExpr("finance.revenue")),
    ),
  );
  const netMargin = unwrap(
    CalculatedMetric.define(
      id("finance.net_margin"),
      "ratio",
      "Net profit / revenue",
      divideExpr(refExpr("finance.net_profit"), refExpr("finance.revenue")),
    ),
  );

  for (const metric of [grossMargin, operatingMargin, netMargin]) {
    registry.metrics.register(metric);
  }
}
