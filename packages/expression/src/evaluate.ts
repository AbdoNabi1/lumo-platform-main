/**
 * The evaluator (ADR-0053 §3, §6).
 *
 * Pure, deterministic, total and side-effect free: identical `(expression, context)` inputs always
 * produce an identical result. No clock, no randomness, no I/O, no reflection — every fact an
 * expression needs must already be in the context, which is what makes evaluation replayable
 * against historical events.
 *
 * Failure is explicit. A missing reference or a type mismatch returns a typed error rather than
 * `false`, because "the rule said no" and "the rule could not be evaluated" have very different
 * consequences for a consent gate or a spend threshold.
 */

import type { Result } from "@platform/types";

import {
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_NODES,
  measureExpression,
  type ComparisonOperator,
  type Expression,
  type Scalar,
} from "./expression";

/** Values an evaluation context may expose. Nested objects are traversed by dot-path. */
export type ContextValue =
  Scalar | undefined | { readonly [key: string]: ContextValue } | readonly ContextValue[];

export interface EvaluationContext {
  readonly [key: string]: ContextValue;
}

export type EvaluationError =
  | { readonly code: "unknown_reference"; readonly path: string }
  | {
      readonly code: "type_mismatch";
      readonly operator: ComparisonOperator;
      readonly detail: string;
    }
  | { readonly code: "not_boolean"; readonly detail: string }
  | { readonly code: "depth_exceeded"; readonly limit: number }
  | { readonly code: "nodes_exceeded"; readonly limit: number };

export type EvaluationResult<T> = Result<T, EvaluationError>;

function ok<T>(value: T): EvaluationResult<T> {
  return { ok: true, value };
}

function err<T>(error: EvaluationError): EvaluationResult<T> {
  return { ok: false, error };
}

/**
 * Resolves a dot-path. Returns `undefined` for a missing path — the caller decides whether that is
 * an error (`ref`) or simply false (`exists`).
 */
function resolvePath(context: EvaluationContext, path: string): ContextValue {
  let current: ContextValue = context;

  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (Array.isArray(current)) return undefined;
    current = (current as { readonly [key: string]: ContextValue })[segment];
  }

  return current;
}

/** Only scalars participate in comparisons; objects and arrays are not comparable. */
function asScalar(value: ContextValue): Scalar | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function compare(op: ComparisonOperator, left: Scalar, right: Scalar): EvaluationResult<boolean> {
  switch (op) {
    case "eq":
      return ok(left === right);
    case "neq":
      return ok(left !== right);

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // Ordering is defined for numbers and for strings, but never across the two: comparing
      // `"10" > 9` silently coerces in JavaScript and is almost always a mapping bug.
      if (typeof left === "number" && typeof right === "number") {
        return ok(orderNumbers(op, left, right));
      }
      if (typeof left === "string" && typeof right === "string") {
        return ok(orderStrings(op, left, right));
      }
      return err({
        code: "type_mismatch",
        operator: op,
        detail: `cannot order ${typeof left} against ${typeof right}`,
      });
    }

    case "contains":
    case "starts_with":
    case "ends_with": {
      if (typeof left !== "string" || typeof right !== "string") {
        return err({
          code: "type_mismatch",
          operator: op,
          detail: `${op} requires two strings`,
        });
      }
      if (op === "contains") return ok(left.includes(right));
      if (op === "starts_with") return ok(left.startsWith(right));
      return ok(left.endsWith(right));
    }
  }
}

function orderNumbers(op: "gt" | "gte" | "lt" | "lte", left: number, right: number): boolean {
  if (op === "gt") return left > right;
  if (op === "gte") return left >= right;
  if (op === "lt") return left < right;
  return left <= right;
}

function orderStrings(op: "gt" | "gte" | "lt" | "lte", left: string, right: string): boolean {
  if (op === "gt") return left > right;
  if (op === "gte") return left >= right;
  if (op === "lt") return left < right;
  return left <= right;
}

/** Evaluates an expression to a scalar. */
function evaluateValue(
  expression: Expression,
  context: EvaluationContext,
): EvaluationResult<Scalar> {
  switch (expression.kind) {
    case "literal":
      return ok(expression.value);

    case "ref": {
      const raw = resolvePath(context, expression.path);
      if (raw === undefined) return err({ code: "unknown_reference", path: expression.path });

      const scalar = asScalar(raw);
      if (scalar === undefined) {
        return err({
          code: "type_mismatch",
          operator: "eq",
          detail: `${expression.path} is not a scalar`,
        });
      }
      return ok(scalar);
    }

    default: {
      const boolean = evaluateNode(expression, context);
      return boolean.ok ? ok(boolean.value) : err(boolean.error);
    }
  }
}

function evaluateNode(
  expression: Expression,
  context: EvaluationContext,
): EvaluationResult<boolean> {
  switch (expression.kind) {
    case "literal": {
      if (typeof expression.value !== "boolean") {
        return err({ code: "not_boolean", detail: `literal ${String(expression.value)}` });
      }
      return ok(expression.value);
    }

    case "ref": {
      const value = evaluateValue(expression, context);
      if (!value.ok) return err(value.error);
      if (typeof value.value !== "boolean") {
        return err({ code: "not_boolean", detail: expression.path });
      }
      return ok(value.value);
    }

    case "exists": {
      const raw = resolvePath(context, expression.path);
      return ok(raw !== undefined && raw !== null);
    }

    case "not": {
      const operand = evaluateNode(expression.operand, context);
      return operand.ok ? ok(!operand.value) : operand;
    }

    case "and": {
      // Short-circuits: a false operand ends evaluation, so a later unresolvable reference does
      // not fail a condition that is already decided.
      for (const operand of expression.operands) {
        const result = evaluateNode(operand, context);
        if (!result.ok) return result;
        if (!result.value) return ok(false);
      }
      return ok(true);
    }

    case "or": {
      for (const operand of expression.operands) {
        const result = evaluateNode(operand, context);
        if (!result.ok) return result;
        if (result.value) return ok(true);
      }
      return ok(false);
    }

    case "compare": {
      const left = evaluateValue(expression.left, context);
      if (!left.ok) return err(left.error);
      const right = evaluateValue(expression.right, context);
      if (!right.ok) return err(right.error);
      return compare(expression.op, left.value, right.value);
    }

    case "in": {
      const value = evaluateValue(expression.value, context);
      if (!value.ok) return err(value.error);
      return ok(expression.set.includes(value.value));
    }
  }
}

/**
 * Evaluates an expression to a boolean. Structural limits are checked first so a hostile or
 * generated expression is rejected before any recursion begins.
 */
export function evaluate(
  expression: Expression,
  context: EvaluationContext,
): EvaluationResult<boolean> {
  const { depth, nodes } = measureExpression(expression);
  if (depth > MAX_EXPRESSION_DEPTH) {
    return err({ code: "depth_exceeded", limit: MAX_EXPRESSION_DEPTH });
  }
  if (nodes > MAX_EXPRESSION_NODES) {
    return err({ code: "nodes_exceeded", limit: MAX_EXPRESSION_NODES });
  }

  return evaluateNode(expression, context);
}

/**
 * Evaluates, treating any error as "did not match". Use **only** where an unevaluable condition is
 * genuinely equivalent to a negative — never for consent, security or spend gates, where the two
 * must stay distinguishable.
 */
export function evaluateOrFalse(expression: Expression, context: EvaluationContext): boolean {
  const result = evaluate(expression, context);
  return result.ok && result.value;
}
