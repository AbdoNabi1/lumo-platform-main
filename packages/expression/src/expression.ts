/**
 * The expression AST (ADR-0053). Expressions are **data, never code**: there is no `eval`, no
 * function construction and no caller-supplied callback anywhere in this package, so a merchant-
 * authored condition cannot execute anything.
 *
 * The AST is plain JSON-serializable objects, which is what lets a rule be stored in the Registry
 * Engine, versioned, diffed, replayed against historical data and edited in an admin surface.
 */

/** The only value types an expression may hold. Deliberately narrow — no dates, no objects. */
export type Scalar = string | number | boolean | null;

/** Comparison operators. Regex is excluded by ADR-0053 §4 (unbounded ReDoS surface). */
export type ComparisonOperator =
  "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts_with" | "ends_with";

export const COMPARISON_OPERATORS: readonly ComparisonOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "starts_with",
  "ends_with",
];

export type Expression =
  /** A constant value. */
  | { readonly kind: "literal"; readonly value: Scalar }
  /** A dot-path lookup into the evaluation context, e.g. `payload.valueMinor`. */
  | { readonly kind: "ref"; readonly path: string }
  /** True when the path is present and not null. */
  | { readonly kind: "exists"; readonly path: string }
  | { readonly kind: "not"; readonly operand: Expression }
  | { readonly kind: "and"; readonly operands: readonly Expression[] }
  | { readonly kind: "or"; readonly operands: readonly Expression[] }
  | {
      readonly kind: "compare";
      readonly op: ComparisonOperator;
      readonly left: Expression;
      readonly right: Expression;
    }
  /** Membership: `value` appears in a literal set. */
  | { readonly kind: "in"; readonly value: Expression; readonly set: readonly Scalar[] };

/** Version stamped on serialized documents so stored expressions stay interpretable. */
export const EXPRESSION_LANGUAGE_VERSION = 1;

/** A stored, versioned expression. */
export interface ExpressionDocument {
  readonly version: number;
  readonly expression: Expression;
}

// ---------------------------------------------------------------------------
// Builders — ergonomic construction without hand-writing AST objects
// ---------------------------------------------------------------------------

export const Expr = {
  literal: (value: Scalar): Expression => ({ kind: "literal", value }),
  ref: (path: string): Expression => ({ kind: "ref", path }),
  exists: (path: string): Expression => ({ kind: "exists", path }),
  not: (operand: Expression): Expression => ({ kind: "not", operand }),
  and: (...operands: readonly Expression[]): Expression => ({ kind: "and", operands }),
  or: (...operands: readonly Expression[]): Expression => ({ kind: "or", operands }),
  compare: (op: ComparisonOperator, left: Expression, right: Expression): Expression => ({
    kind: "compare",
    op,
    left,
    right,
  }),
  in: (value: Expression, set: readonly Scalar[]): Expression => ({ kind: "in", value, set }),

  /** `path <op> value` — the shape almost every real condition takes. */
  where: (path: string, op: ComparisonOperator, value: Scalar): Expression => ({
    kind: "compare",
    op,
    left: { kind: "ref", path },
    right: { kind: "literal", value },
  }),
} as const;

// ---------------------------------------------------------------------------
// Structural limits (ADR-0053 §4)
// ---------------------------------------------------------------------------

/** Maximum nesting depth. Bounds stack use for hostile or machine-generated expressions. */
export const MAX_EXPRESSION_DEPTH = 32;

/** Maximum total node count. Bounds evaluation cost independently of depth. */
export const MAX_EXPRESSION_NODES = 512;

export interface ExpressionMetrics {
  readonly depth: number;
  readonly nodes: number;
}

/** Measures an expression without evaluating it. */
export function measureExpression(expression: Expression): ExpressionMetrics {
  let nodes = 0;

  function walk(node: Expression, depth: number): number {
    nodes += 1;

    switch (node.kind) {
      case "literal":
      case "ref":
      case "exists":
        return depth;
      case "not":
        return walk(node.operand, depth + 1);
      case "in":
        return walk(node.value, depth + 1);
      case "compare":
        return Math.max(walk(node.left, depth + 1), walk(node.right, depth + 1));
      case "and":
      case "or": {
        let deepest = depth;
        for (const operand of node.operands) {
          deepest = Math.max(deepest, walk(operand, depth + 1));
        }
        return deepest;
      }
    }
  }

  const depth = walk(expression, 1);
  return { depth, nodes };
}

// ---------------------------------------------------------------------------
// Structural validation — run before storing an expression, not at evaluation time
// ---------------------------------------------------------------------------

export type ExpressionStructureError =
  | { readonly code: "depth_exceeded"; readonly depth: number; readonly limit: number }
  | { readonly code: "nodes_exceeded"; readonly nodes: number; readonly limit: number }
  | { readonly code: "empty_operands"; readonly kind: "and" | "or" }
  | { readonly code: "empty_path" }
  | { readonly code: "empty_set" };

/**
 * Checks the structural invariants an expression must satisfy to be storable. Separated from
 * evaluation so a malformed rule is rejected when it is authored rather than when it fires.
 */
export function validateExpressionStructure(
  expression: Expression,
): readonly ExpressionStructureError[] {
  const errors: ExpressionStructureError[] = [];
  const { depth, nodes } = measureExpression(expression);

  if (depth > MAX_EXPRESSION_DEPTH) {
    errors.push({ code: "depth_exceeded", depth, limit: MAX_EXPRESSION_DEPTH });
  }
  if (nodes > MAX_EXPRESSION_NODES) {
    errors.push({ code: "nodes_exceeded", nodes, limit: MAX_EXPRESSION_NODES });
  }

  function walk(node: Expression): void {
    switch (node.kind) {
      case "literal":
        return;
      case "ref":
      case "exists":
        if (node.path.trim() === "") errors.push({ code: "empty_path" });
        return;
      case "not":
        walk(node.operand);
        return;
      case "compare":
        walk(node.left);
        walk(node.right);
        return;
      case "in":
        if (node.set.length === 0) errors.push({ code: "empty_set" });
        walk(node.value);
        return;
      case "and":
      case "or":
        // An empty AND is vacuously true and an empty OR vacuously false; both are almost
        // certainly authoring mistakes, so they are rejected rather than silently interpreted.
        if (node.operands.length === 0) errors.push({ code: "empty_operands", kind: node.kind });
        for (const operand of node.operands) walk(operand);
        return;
    }
  }

  walk(expression);
  return errors;
}
