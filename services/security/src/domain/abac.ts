/**
 * An **ABAC condition** (sprint P2.0-C §16) — attribute equality constraints over the principal, the
 * target resource and the environment. Every specified attribute must match for the condition to hold
 * (an empty condition always holds). Kept as data (not code) so it is versionable and explainable,
 * consistent with the policy model.
 */
export interface AbacCondition {
  readonly principal?: Readonly<Record<string, string>>;
  readonly resource?: Readonly<Record<string, string>>;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface AbacContext {
  readonly principal: Readonly<Record<string, string>>;
  readonly resource: Readonly<Record<string, string>>;
  readonly environment: Readonly<Record<string, string>>;
}

/** One unmet attribute, for explanation. */
export interface AbacMismatch {
  readonly dimension: "principal" | "resource" | "environment";
  readonly attribute: string;
  readonly expected: string;
  readonly actual: string | null;
}

export interface AbacResult {
  readonly satisfied: boolean;
  readonly mismatches: readonly AbacMismatch[];
}

/**
 * The **ABAC evaluator** — pure, deterministic, explainable attribute matching. Returns which
 * attributes failed so a denial can be explained (`explainDecision()`), and composes with RBAC/ReBAC
 * (the principal must hold the permission *and* satisfy the attribute constraints).
 */
export class AttributeEvaluator {
  evaluate(condition: AbacCondition, context: AbacContext): AbacResult {
    const mismatches: AbacMismatch[] = [];
    const check = (
      dimension: AbacMismatch["dimension"],
      expected: Readonly<Record<string, string>> | undefined,
      actual: Readonly<Record<string, string>>,
    ): void => {
      if (expected === undefined) return;
      for (const [attribute, value] of Object.entries(expected)) {
        const got = actual[attribute];
        if (got !== value)
          mismatches.push({ dimension, attribute, expected: value, actual: got ?? null });
      }
    };
    check("principal", condition.principal, context.principal);
    check("resource", condition.resource, context.resource);
    check("environment", condition.environment, context.environment);
    return { satisfied: mismatches.length === 0, mismatches };
  }
}
