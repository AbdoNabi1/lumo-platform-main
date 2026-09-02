import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

/**
 * A small, typed AST for calculated-metric formulas — deliberately not a formula string or
 * `eval`. `ref` nodes name another metric's canonical id by value (resolved by
 * `MetricDependencyResolver`/`ExpressionEvaluator`, never imported).
 */
export type MetricExpression =
  | { readonly kind: "ref"; readonly metricId: string }
  | { readonly kind: "literal"; readonly value: number }
  | {
      readonly kind: "add" | "subtract" | "multiply" | "divide";
      readonly left: MetricExpression;
      readonly right: MetricExpression;
    };

export function refExpr(metricId: string): MetricExpression {
  return { kind: "ref", metricId };
}

export function literalExpr(value: number): MetricExpression {
  return { kind: "literal", value };
}

export function divideExpr(left: MetricExpression, right: MetricExpression): MetricExpression {
  return { kind: "divide", left, right };
}

export function subtractExpr(left: MetricExpression, right: MetricExpression): MetricExpression {
  return { kind: "subtract", left, right };
}

export function addExpr(left: MetricExpression, right: MetricExpression): MetricExpression {
  return { kind: "add", left, right };
}

export function multiplyExpr(left: MetricExpression, right: MetricExpression): MetricExpression {
  return { kind: "multiply", left, right };
}

/** Every metric id a `ref` node anywhere in `expr` names, depth-first, duplicates included. */
export function collectReferencedMetricIds(expr: MetricExpression): readonly string[] {
  switch (expr.kind) {
    case "ref":
      return [expr.metricId];
    case "literal":
      return [];
    default:
      return [...collectReferencedMetricIds(expr.left), ...collectReferencedMetricIds(expr.right)];
  }
}

/** Structural validation only — reference existence is `MetricDependencyResolver`'s job. */
export function defineMetricExpression(
  expr: MetricExpression,
): Result<MetricExpression, ValidationError> {
  if (expr.kind === "ref" && expr.metricId.trim().length === 0) {
    return err(
      new ValidationError("Invalid metric expression", [
        { field: "metricId", message: "ref node must name a non-empty metric id" },
      ]),
    );
  }
  if (expr.kind === "literal" && !Number.isFinite(expr.value)) {
    return err(
      new ValidationError("Invalid metric expression", [
        { field: "value", message: "literal node must be a finite number" },
      ]),
    );
  }
  if (
    expr.kind === "add" ||
    expr.kind === "subtract" ||
    expr.kind === "multiply" ||
    expr.kind === "divide"
  ) {
    const left = defineMetricExpression(expr.left);
    if (!left.ok) return left;
    const right = defineMetricExpression(expr.right);
    if (!right.ok) return right;
  }
  return ok(expr);
}
