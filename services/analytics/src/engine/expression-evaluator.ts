import type { MetricExpression } from "../domain/value-objects/metric-expression";

/**
 * Evaluates a {@link MetricExpression} against already-computed metric values. Division by zero
 * resolves to `0` (a KPI with no denominator yet — e.g. margin before any revenue — reads as `0`,
 * never `NaN`/`Infinity`); any other non-finite intermediate result is likewise clamped to `0`
 * rather than propagated.
 */
export const ExpressionEvaluator = {
  evaluate(expr: MetricExpression, values: ReadonlyMap<string, number>): number {
    switch (expr.kind) {
      case "literal":
        return expr.value;
      case "ref":
        return values.get(expr.metricId) ?? 0;
      case "add":
        return finite(
          ExpressionEvaluator.evaluate(expr.left, values) +
            ExpressionEvaluator.evaluate(expr.right, values),
        );
      case "subtract":
        return finite(
          ExpressionEvaluator.evaluate(expr.left, values) -
            ExpressionEvaluator.evaluate(expr.right, values),
        );
      case "multiply":
        return finite(
          ExpressionEvaluator.evaluate(expr.left, values) *
            ExpressionEvaluator.evaluate(expr.right, values),
        );
      case "divide": {
        const divisor = ExpressionEvaluator.evaluate(expr.right, values);
        if (divisor === 0) return 0;
        return finite(ExpressionEvaluator.evaluate(expr.left, values) / divisor);
      }
    }
  },
} as const;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
