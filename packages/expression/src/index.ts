/**
 * `@platform/expression` — the **only** boolean expression engine on the platform (ADR-0053).
 *
 * Pure · deterministic · side-effect free · versioned · serializable · browser- and server-
 * compatible · sandbox-safe. No I/O, no network, no database, no clock, no randomness, no runtime
 * reflection, no `eval`. It depends on `@platform/types` and nothing else, so the guarantee is
 * visible in the dependency graph rather than only in this comment.
 *
 * No bounded context may implement its own expression evaluator again.
 */

export type {
  Scalar,
  ComparisonOperator,
  Expression,
  ExpressionDocument,
  ExpressionMetrics,
  ExpressionStructureError,
} from "./expression";
export {
  COMPARISON_OPERATORS,
  EXPRESSION_LANGUAGE_VERSION,
  Expr,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_NODES,
  measureExpression,
  validateExpressionStructure,
} from "./expression";

export type {
  ContextValue,
  EvaluationContext,
  EvaluationError,
  EvaluationResult,
} from "./evaluate";
export { evaluate, evaluateOrFalse } from "./evaluate";
