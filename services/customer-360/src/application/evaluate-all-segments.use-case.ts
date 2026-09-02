import type { UseCase } from "@platform/application";
import type { Expression } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { AttributeDependency } from "../domain/attribute-dependency";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentDefinition } from "../ports/segment-definition";
import type { SegmentEvaluationResult } from "../ports/segment-evaluation";
import type { EvaluateSegment } from "./evaluate-segment.use-case";
import type { UpdateSegmentMembershipProjection } from "./update-segment-membership-projection.use-case";

export interface EvaluateAllSegmentsInput {
  readonly identifier: IdentifierRef;
  /** Definitions to evaluate — need not be pre-sorted and no ordering is imposed on them; see this
   * class's own doc for why. May be a proper subset of the full registry
   * (`RecalculateMemberships` passes exactly the incremental-recompute closure). */
  readonly definitions: readonly SegmentDefinition[];
}

export interface EvaluateAllSegmentsOutput {
  readonly results: readonly SegmentEvaluationResult[];
  /** Segment ids whose membership actually changed and were persisted this run (`applied: true` from
   * `UpdateSegmentMembershipProjection`) — a no-op re-evaluation is excluded. */
  readonly applied: readonly string[];
}

export interface EvaluateAllSegmentsDeps {
  readonly evaluate: EvaluateSegment;
  readonly updateProjection: UpdateSegmentMembershipProjection;
}

/** Walks one rule's condition tree collecting every `ref`/`exists` path it reads. The mechanism
 * `toSegmentDependencyEdges` uses to build the fact→segment dependency graph — segments have no
 * declared `dependencies` field to read instead (`ports/segment-definition.ts` has none;
 * `SEGMENTATION_MODEL.md` §5 explains why). */
function collectExpressionPaths(expression: Expression, paths: Set<string>): void {
  switch (expression.kind) {
    case "literal":
      return;
    case "ref":
    case "exists":
      paths.add(expression.path);
      return;
    case "not":
      collectExpressionPaths(expression.operand, paths);
      return;
    case "in":
      collectExpressionPaths(expression.value, paths);
      return;
    case "compare":
      collectExpressionPaths(expression.left, paths);
      collectExpressionPaths(expression.right, paths);
      return;
    case "and":
    case "or":
      for (const operand of expression.operands) collectExpressionPaths(operand, paths);
      return;
  }
}

/** Every fact path (e.g. `"profile.ltv"`, `"attributes.vip_tier"`, `"journey.sessionCount"`) a rule
 * set's rules reference — the leaves of the fact→segment dependency graph. Exported so
 * `RecalculateMemberships`/tests can inspect a single definition's own referenced paths directly. */
export function collectReferencedPaths(ruleSet: RuleSet<boolean>): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const rule of ruleSet.rules) {
    collectExpressionPaths(rule.when, paths);
  }
  return paths;
}

/**
 * Edges among `definitions` — each definition's referenced fact paths (`collectReferencedPaths`)
 * flattened to the pure graph shape `domain/attribute-dependency.ts` already operates on
 * (`AttributeDependency { attribute, dependsOn }`, reused verbatim — **no second dependency-graph
 * implementation exists in this engine**). `attribute` holds a segment id; `dependsOn` holds a fact
 * path, never another segment id — segments never depend on segments
 * (`SEGMENTATION_MODEL.md` §5). Exported so `RecalculateMemberships` can build the same edges once,
 * from the full registry, to compute its incremental-recompute closure via the reused
 * `dependentsOf`.
 */
export function toSegmentDependencyEdges(
  definitions: readonly SegmentDefinition[],
): readonly AttributeDependency[] {
  const edges: AttributeDependency[] = [];
  for (const definition of definitions) {
    for (const path of collectReferencedPaths(definition.ruleSet)) {
      edges.push({ attribute: definition.id, dependsOn: path });
    }
  }
  return edges;
}

/**
 * Evaluates a whole (or scoped) segment set for one identifier, persisting each result as it goes.
 * Unlike `EvaluateAttributeGraph`, there is **no ordering step**: a segment's rule set can never read
 * another segment's outcome (the evaluation context `EvaluateSegment` builds has no such namespace;
 * `SEGMENTATION_MODEL.md` §4/§5), so `definitions` is evaluated in whatever order it is given — no
 * `topologicalOrder` call, no cycle-detection error path, because there is no ordering constraint to
 * violate in the first place. This is a genuinely simpler design than `EvaluateAttributeGraph`, not
 * an equivalent one with an unused safety net.
 */
export class EvaluateAllSegments implements UseCase<
  EvaluateAllSegmentsInput,
  EvaluateAllSegmentsOutput,
  DomainError
> {
  private readonly deps: EvaluateAllSegmentsDeps;

  constructor(deps: EvaluateAllSegmentsDeps) {
    this.deps = deps;
  }

  async execute(
    input: EvaluateAllSegmentsInput,
  ): Promise<Result<EvaluateAllSegmentsOutput, DomainError>> {
    const results: SegmentEvaluationResult[] = [];
    const applied: string[] = [];

    for (const definition of input.definitions) {
      const evaluated = await this.deps.evaluate.execute({
        identifier: input.identifier,
        definition,
      });
      if (!evaluated.ok) return evaluated;
      results.push(evaluated.value.result);

      const persisted = await this.deps.updateProjection.execute({
        identifier: input.identifier,
        result: evaluated.value.result,
      });
      if (!persisted.ok) return persisted;
      if (persisted.value.applied) applied.push(definition.id);
    }

    return ok({ results, applied });
  }
}
