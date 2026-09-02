import type { RuleSet } from "@platform/rules";
import type { AttributeValue } from "../domain/attribute-value";

/**
 * Configuration for one computed attribute — **not** domain (dependency-cruiser's `domain-stays-pure`
 * forbids `src/domain/` from importing `@platform/rules`/`@platform/expression`; this is the exact
 * reason `ports/identity-decision.ts` — not `domain/customer-profile.ts` — is where a cross-package
 * type like `IdentifierRef` lives). Per ADR-0053, this is the **only** place Computed Attributes may
 * express "how to compute a value from facts": a `RuleSet<AttributeValue>` evaluated by
 * `@platform/rules`' `evaluateRuleSet` against an `EvaluationContext` built from the identifier's
 * profile fields, journey state, and already-evaluated dependency attributes
 * (`application/evaluate-computed-attribute.use-case.ts`). No bounded context — this one included —
 * may fork its own expression evaluator; every rule this engine runs is data, never code.
 *
 * `id` is the definition's single stable key: the map key in `ComputedAttribute.attributes`, the
 * `attributes.<id>` reference path segment another definition's own expression uses to read this
 * one's value, and the `dependencies` entry a dependent definition names — one identifier, not an
 * `id`/`name` pair, matching `Rule.id`/`RuleSet.id`'s own single-key precedent in `@platform/rules`.
 */
export interface ComputedAttributeDefinition {
  readonly id: string;
  /** Bumped whenever the rule set itself changes (not on every evaluation) — carried onto every
   * `ComputedAttributeValue` this definition produces, so a stored value can always be traced back
   * to the exact rule-set version that computed it, even after the definition is later edited. */
  readonly version: number;
  readonly ruleSet: RuleSet<AttributeValue>;
  /** Ids of other `ComputedAttributeDefinition`s this one's rule set reads via `attributes.<id>` —
   * the edges `domain/attribute-dependency.ts`'s graph functions operate on. Declaring a dependency
   * here that the rule set does not actually reference is harmless but misleading (the graph would
   * over-order); declaring a reference the rule set uses but omitting it here is the real hazard —
   * `EvaluateAttributeGraph` cannot detect it and would evaluate that dependency out of order or not
   * at all, so authoring tooling (out of scope for Phase 6.4; see the report's deferred-work
   * section) should eventually validate the two stay in sync. */
  readonly dependencies: readonly string[];
  readonly description?: string;
}
