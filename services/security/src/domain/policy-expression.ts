import { evaluateLeaf, type PolicyCondition, type PolicyEvalContext } from "./policy-condition";

/**
 * A **composable policy expression** (sprint P2.0-D §8) — boolean logic over leaf conditions:
 * `allOf` (AND), `anyOf` (OR), `not` (NOT), nested arbitrarily, plus `fragment` references to
 * **reusable** named expressions held in the Registry Engine. This is **data, not a DSL** — it
 * extends the existing structured condition model and is evaluated by the existing engine (no new
 * language, no new engine kernel). Versionable, simulatable, explainable like the rest of policy.
 */
export type PolicyExpression =
  | { readonly leaf: PolicyCondition }
  | { readonly allOf: readonly PolicyExpression[] }
  | { readonly anyOf: readonly PolicyExpression[] }
  | { readonly not: PolicyExpression }
  | { readonly fragment: string };

/** A reusable, named policy expression stored in the Registry Engine (`packages/registry`, versioned). */
export interface PolicyFragment {
  readonly key: string;
  readonly description?: string;
  readonly expression: PolicyExpression;
}

/** Resolves a fragment key to its expression (registry-backed adapter). */
export interface FragmentResolver {
  resolve(key: string): PolicyExpression | null;
}

const NO_FRAGMENTS: FragmentResolver = { resolve: () => null };
const MAX_DEPTH = 64;

/**
 * Evaluates a {@link PolicyExpression} against the context, resolving `fragment` references (cycle-
 * and depth-safe). Leaf evaluation reuses {@link evaluateLeaf}. Pure and deterministic.
 */
export class PolicyExpressionEvaluator {
  evaluate(
    expression: PolicyExpression,
    context: PolicyEvalContext,
    resolver: FragmentResolver = NO_FRAGMENTS,
  ): boolean {
    return this.walk(expression, context, resolver, new Set<string>(), 0);
  }

  private walk(
    expression: PolicyExpression,
    context: PolicyEvalContext,
    resolver: FragmentResolver,
    seen: Set<string>,
    depth: number,
  ): boolean {
    if (depth > MAX_DEPTH) return false;
    if ("leaf" in expression) return evaluateLeaf(expression.leaf, context);
    if ("allOf" in expression)
      return expression.allOf.every((e) => this.walk(e, context, resolver, seen, depth + 1));
    if ("anyOf" in expression)
      return expression.anyOf.some((e) => this.walk(e, context, resolver, seen, depth + 1));
    if ("not" in expression) return !this.walk(expression.not, context, resolver, seen, depth + 1);
    // fragment reference
    if (seen.has(expression.fragment)) return false; // cycle guard
    seen.add(expression.fragment);
    const resolved = resolver.resolve(expression.fragment);
    if (resolved === null) return false; // unknown fragment ⇒ does not fire
    return this.walk(resolved, context, resolver, seen, depth + 1);
  }
}
