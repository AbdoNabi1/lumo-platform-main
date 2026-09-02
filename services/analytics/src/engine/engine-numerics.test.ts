import { describe, expect, it } from "vitest";
import {
  divideExpr,
  literalExpr,
  refExpr,
  subtractExpr,
} from "../domain/value-objects/metric-expression";
import { AggregationEngine } from "./aggregation-engine";
import { ExpressionEvaluator } from "./expression-evaluator";

describe("ExpressionEvaluator", () => {
  it("resolves division by zero to 0, never NaN/Infinity", () => {
    const expr = divideExpr(literalExpr(100), literalExpr(0));
    expect(ExpressionEvaluator.evaluate(expr, new Map())).toBe(0);
  });

  it("clamps a non-finite intermediate result to 0", () => {
    const expr = subtractExpr(refExpr("missing"), literalExpr(0));
    expect(ExpressionEvaluator.evaluate(expr, new Map())).toBe(0);
  });

  it("resolves an unresolved ref to 0 rather than throwing", () => {
    const expr = refExpr("does.not.exist");
    expect(ExpressionEvaluator.evaluate(expr, new Map())).toBe(0);
  });

  it("evaluates a real ratio correctly", () => {
    const expr = divideExpr(refExpr("gross_profit"), refExpr("revenue"));
    const values = new Map([
      ["gross_profit", 60000],
      ["revenue", 100000],
    ]);
    expect(ExpressionEvaluator.evaluate(expr, values)).toBe(0.6);
  });
});

describe("AggregationEngine", () => {
  const rows = [{ amount: 10 }, { amount: 20 }, { amount: "30" }, { amount: "not-a-number" }, {}];

  it("sums only numeric/numeric-string values, excluding non-numeric ones", () => {
    expect(AggregationEngine.aggregate(rows, "sum", "amount")).toBe(60);
  });

  it("averages only numeric values", () => {
    expect(AggregationEngine.aggregate(rows, "avg", "amount")).toBe(20);
  });

  it("counts every row regardless of field validity", () => {
    expect(AggregationEngine.aggregate(rows, "count", "amount")).toBe(5);
  });

  it("min/max over numeric values only", () => {
    expect(AggregationEngine.aggregate(rows, "min", "amount")).toBe(10);
    expect(AggregationEngine.aggregate(rows, "max", "amount")).toBe(30);
  });

  it("resolves an empty numeric set to 0, never NaN", () => {
    expect(AggregationEngine.aggregate([], "avg", "amount")).toBe(0);
    expect(AggregationEngine.aggregate([], "sum", "amount")).toBe(0);
    expect(AggregationEngine.aggregate([], "min", "amount")).toBe(0);
  });

  it("count_distinct counts unique non-null values", () => {
    const distinctRows = [{ tag: "a" }, { tag: "a" }, { tag: "b" }, {}];
    expect(AggregationEngine.aggregate(distinctRows, "count_distinct", "tag")).toBe(2);
  });
});
