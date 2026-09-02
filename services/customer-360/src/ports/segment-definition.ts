import type { RuleSet } from "@platform/rules";

/**
 * Configuration for one segment — **not** domain, for the identical reason
 * `ComputedAttributeDefinition` (`ports/computed-attribute-definition.ts`) is not: it embeds a
 * `RuleSet`, and dependency-cruiser's `domain-stays-pure` rule forbids `src/domain/` from importing
 * `@platform/rules`/`@platform/expression`. Per ADR-0053, this is the **only** place Segmentation may
 * express "what makes someone a member": a `RuleSet<boolean>` evaluated by `@platform/rules`'
 * `evaluateRuleSet` against the identical three-namespace `EvaluationContext`
 * `EvaluateComputedAttribute` already builds (`application/evaluate-segment.use-case.ts`). No bounded
 * context — this one included — may fork its own expression evaluator; every rule this engine runs is
 * data, never code.
 *
 * `RuleSet<boolean>`, not `RuleSet<CustomerContext>` — `RuleSet<TOutcome>` is generic over what a
 * *matching rule produces*, not over the shape of the context it reads (the context is always the
 * fixed `EvaluationContext` from `@platform/expression`). A segment rule matches and produces
 * `then: true`; the set's `fallback` is `false` (or omitted — no match with no fallback also resolves
 * to "not a member").
 */
export interface SegmentDefinition {
  /** The definition's single stable key: the map key in `CustomerSegment.memberships`, and the id
   * `GetSegmentMembers`/`RecalculateMemberships` take — one identifier, not an `id`/`name` pair,
   * matching `Rule.id`/`RuleSet.id`'s own single-key precedent in `@platform/rules`. */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Bumped whenever the rule set itself changes (not on every evaluation) — carried onto every
   * `SegmentMembership` this definition produces, so a stored row can always be traced back to the
   * exact rule-set version that computed it, even after the definition is later edited. */
  readonly version: number;
  readonly ruleSet: RuleSet<boolean>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The `expectedVersion` `CreateSegment` passes to `SegmentDefinitionRegistry.save` — "no definition
 * must exist yet under this id" — mirroring `INITIAL_ATTRIBUTE_VERSION`'s role in `AttributeStore`'s
 * own CAS create-branch. */
export const INITIAL_SEGMENT_DEFINITION_VERSION = 0;
