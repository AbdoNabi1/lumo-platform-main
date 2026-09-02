import { describe, expect, it } from "vitest";

import {
  Expr,
  MAX_EXPRESSION_DEPTH,
  measureExpression,
  validateExpressionStructure,
  type Expression,
} from "./expression";
import { evaluate, evaluateOrFalse, type EvaluationContext } from "./evaluate";

const CONTEXT: EvaluationContext = {
  payload: { valueMinor: 150_000, currency: "USD", coupon: null },
  identity: { country: "sa", email: "ali@example.com" },
  consent: { marketing: true },
};

function mustBe(expression: Expression, expected: boolean): void {
  const result = evaluate(expression, CONTEXT);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toBe(expected);
}

describe("evaluation", () => {
  it("compares numbers", () => {
    mustBe(Expr.where("payload.valueMinor", "gt", 100_000), true);
    mustBe(Expr.where("payload.valueMinor", "lte", 100_000), false);
  });

  it("compares strings and supports substring operators", () => {
    mustBe(Expr.where("payload.currency", "eq", "USD"), true);
    mustBe(Expr.where("identity.email", "ends_with", "@example.com"), true);
    mustBe(Expr.where("identity.email", "contains", "nope"), false);
  });

  it("evaluates membership", () => {
    mustBe(Expr.in(Expr.ref("identity.country"), ["sa", "ae", "eg"]), true);
    mustBe(Expr.in(Expr.ref("identity.country"), ["us"]), false);
  });

  it("evaluates exists, distinguishing null from missing", () => {
    mustBe(Expr.exists("identity.email"), true);
    mustBe(Expr.exists("payload.coupon"), false); // present but null
    mustBe(Expr.exists("payload.nothing"), false);
  });

  it("composes and/or/not", () => {
    mustBe(
      Expr.and(
        Expr.where("payload.valueMinor", "gt", 100_000),
        Expr.in(Expr.ref("identity.country"), ["sa"]),
      ),
      true,
    );
    mustBe(
      Expr.or(Expr.where("payload.currency", "eq", "EUR"), Expr.exists("identity.email")),
      true,
    );
    mustBe(Expr.not(Expr.where("payload.currency", "eq", "USD")), false);
  });

  it("short-circuits AND so a decided condition survives a later bad reference", () => {
    const expression = Expr.and(
      Expr.where("payload.currency", "eq", "EUR"), // false — ends evaluation
      Expr.where("does.not.exist", "eq", 1),
    );
    mustBe(expression, false);
  });

  it("short-circuits OR symmetrically", () => {
    mustBe(Expr.or(Expr.exists("identity.email"), Expr.where("does.not.exist", "eq", 1)), true);
  });
});

describe("explicit failure (ADR-0053 §6)", () => {
  it("errors on an unknown reference rather than returning false", () => {
    const result = evaluate(Expr.where("payload.missing", "gt", 1), CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_reference");
  });

  it("refuses to order a string against a number instead of coercing", () => {
    const result = evaluate(Expr.where("payload.currency", "gt", 5), CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("type_mismatch");
  });

  it("refuses a non-boolean expression as a condition", () => {
    const result = evaluate(Expr.ref("payload.currency"), CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_boolean");
  });

  it("does not treat an object as a comparable scalar", () => {
    const result = evaluate(Expr.where("payload", "eq", "x"), CONTEXT);
    expect(result.ok).toBe(false);
  });

  it("evaluateOrFalse collapses errors, and is documented as unsafe for gates", () => {
    expect(evaluateOrFalse(Expr.where("payload.missing", "gt", 1), CONTEXT)).toBe(false);
  });
});

describe("determinism and purity", () => {
  it("returns identical results across repeated evaluations", () => {
    const expression = Expr.and(
      Expr.where("payload.valueMinor", "gt", 1000),
      Expr.in(Expr.ref("identity.country"), ["sa", "eg"]),
    );
    const runs = Array.from({ length: 25 }, () => JSON.stringify(evaluate(expression, CONTEXT)));
    expect(new Set(runs).size).toBe(1);
  });

  it("does not mutate the context or the expression", () => {
    const expression = Expr.where("payload.valueMinor", "gt", 1);
    const contextBefore = JSON.stringify(CONTEXT);
    const expressionBefore = JSON.stringify(expression);

    evaluate(expression, CONTEXT);

    expect(JSON.stringify(CONTEXT)).toBe(contextBefore);
    expect(JSON.stringify(expression)).toBe(expressionBefore);
  });

  it("round-trips through JSON with no loss", () => {
    const expression = Expr.and(
      Expr.where("payload.valueMinor", "gte", 500),
      Expr.not(Expr.in(Expr.ref("identity.country"), ["us", "ca"])),
    );
    const revived = JSON.parse(JSON.stringify(expression)) as Expression;
    expect(evaluate(revived, CONTEXT)).toEqual(evaluate(expression, CONTEXT));
  });
});

describe("sandbox safety (ADR-0053 §4)", () => {
  function nest(depth: number): Expression {
    let expression: Expression = Expr.literal(true);
    for (let i = 0; i < depth; i += 1) expression = Expr.not(expression);
    return expression;
  }

  it("rejects an expression deeper than the limit before recursing", () => {
    const result = evaluate(nest(MAX_EXPRESSION_DEPTH + 5), CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("depth_exceeded");
  });

  it("accepts an expression at the limit", () => {
    expect(evaluate(nest(MAX_EXPRESSION_DEPTH - 2), CONTEXT).ok).toBe(true);
  });

  it("rejects an expression exceeding the node budget", () => {
    const wide = Expr.and(...Array.from({ length: 600 }, () => Expr.literal(true)));
    const result = evaluate(wide, CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("nodes_exceeded");
  });

  it("measures depth and node count", () => {
    expect(measureExpression(Expr.literal(true))).toEqual({ depth: 1, nodes: 1 });
    expect(measureExpression(Expr.not(Expr.literal(true))).nodes).toBe(2);
  });

  it("exposes no regex operator — the ReDoS surface is excluded by design", () => {
    const operators = JSON.stringify(Expr.where("a", "contains", "b"));
    expect(operators).not.toContain("matches");
    expect(operators).not.toContain("regex");
  });
});

describe("structural validation", () => {
  it("accepts a well-formed expression", () => {
    expect(validateExpressionStructure(Expr.where("a.b", "eq", 1))).toEqual([]);
  });

  it("rejects empty operand lists as authoring mistakes", () => {
    expect(validateExpressionStructure(Expr.and())[0]?.code).toBe("empty_operands");
    expect(validateExpressionStructure(Expr.or())[0]?.code).toBe("empty_operands");
  });

  it("rejects empty paths and empty sets", () => {
    expect(validateExpressionStructure(Expr.ref("  "))[0]?.code).toBe("empty_path");
    expect(validateExpressionStructure(Expr.in(Expr.ref("a"), []))[0]?.code).toBe("empty_set");
  });

  it("reports limit breaches at authoring time", () => {
    const deep = validateExpressionStructure(
      Array.from({ length: MAX_EXPRESSION_DEPTH + 3 }).reduce<Expression>(
        (acc) => Expr.not(acc),
        Expr.literal(true),
      ),
    );
    expect(deep.some((e) => e.code === "depth_exceeded")).toBe(true);
  });
});
