import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError } from "@platform/utils";
import { topologicalOrder, type AttributeDependency } from "../domain/attribute-dependency";
import type { AttributeEvaluationResult } from "../ports/attribute-evaluation";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";
import type { IdentifierRef } from "../ports/identity-decision";
import type { EvaluateComputedAttribute } from "./evaluate-computed-attribute.use-case";
import type { UpdateComputedAttributeProjection } from "./update-computed-attribute-projection.use-case";

export interface EvaluateAttributeGraphInput {
  readonly identifier: IdentifierRef;
  /**
   * Definitions to evaluate — need not be pre-sorted; this use case orders them itself. May be a
   * proper subset of the full registry (`RecalculateComputedAttributes` passes exactly the
   * incremental-recompute closure): a `dependencies` entry pointing **outside** this list is not
   * treated as a constraint on this call's own ordering — the target is assumed already resolved and
   * persisted from an earlier run, and `EvaluateComputedAttribute` reads it live from `AttributeStore`
   * regardless of whether it is in scope this call. Whether that id corresponds to a *registered*
   * definition anywhere is a registry-aware question this use case cannot answer (it only knows the
   * definitions it was handed) — that check is `RecalculateComputedAttributes`'s job, against the
   * full registry, once, up front.
   */
  readonly definitions: readonly ComputedAttributeDefinition[];
}

export interface EvaluateAttributeGraphOutput {
  readonly results: readonly AttributeEvaluationResult[];
  /** Ids whose value actually changed and were persisted this run (`applied: true` from
   * `UpdateComputedAttributeProjection`) — a no-op re-evaluation is excluded, the same signal
   * `RecalculateComputedAttributes` needs to decide whether *this* run's own results should widen an
   * outer incremental recompute. */
  readonly applied: readonly string[];
}

export interface EvaluateAttributeGraphDeps {
  readonly evaluate: EvaluateComputedAttribute;
  readonly updateProjection: UpdateComputedAttributeProjection;
}

/** Edges among `definitions` — a definition's `dependencies` array (`ports/
 * computed-attribute-definition.ts`) flattened to the pure graph shape `domain/
 * attribute-dependency.ts` operates on. Exported so `RecalculateComputedAttributes` can build the
 * same edges once, from the full registry, to compute its incremental-recompute closure. */
export function toDependencyEdges(
  definitions: readonly ComputedAttributeDefinition[],
): readonly AttributeDependency[] {
  const edges: AttributeDependency[] = [];
  for (const definition of definitions) {
    for (const dependsOn of definition.dependencies) {
      edges.push({ attribute: definition.id, dependsOn });
    }
  }
  return edges;
}

/**
 * Evaluates a whole (or scoped) attribute graph for one identifier, in dependency order, persisting
 * each result as it goes so a later node in the same run sees its own dependencies' freshly
 * evaluated values (`EvaluateComputedAttribute` reads dependency values from `AttributeStore`, which
 * this use case keeps current one node at a time — not a second, in-memory value-passing mechanism).
 *
 * **Cycle detection is not optional**: `domain/attribute-dependency.ts`'s `topologicalOrder` is
 * always run first; on a cycle, this use case stops before evaluating anything and returns a
 * `BusinessRuleError` naming the exact cycle — the Phase 6.4 brief's explicit requirement ("stop
 * execution; return a clear error"), never a partial or best-effort ordering.
 */
export class EvaluateAttributeGraph implements UseCase<
  EvaluateAttributeGraphInput,
  EvaluateAttributeGraphOutput,
  DomainError
> {
  private readonly deps: EvaluateAttributeGraphDeps;

  constructor(deps: EvaluateAttributeGraphDeps) {
    this.deps = deps;
  }

  async execute(
    input: EvaluateAttributeGraphInput,
  ): Promise<Result<EvaluateAttributeGraphOutput, DomainError>> {
    const byId = new Map(input.definitions.map((definition) => [definition.id, definition]));
    const names = [...byId.keys()];
    const nameSet = new Set(names);
    const edges = toDependencyEdges(input.definitions).filter((edge) =>
      nameSet.has(edge.dependsOn),
    );

    const ordered = topologicalOrder(names, edges);
    if (!ordered.ok) {
      return err(
        new BusinessRuleError(
          `Computed attribute dependency cycle detected: ${ordered.error.cycle.join(" -> ")}`,
          { context: { cycle: ordered.error.cycle } },
        ),
      );
    }

    const results: AttributeEvaluationResult[] = [];
    const applied: string[] = [];

    for (const id of ordered.order) {
      // `ordered.order` is a permutation of `names` (`topologicalOrder`'s contract), and `names`
      // is exactly `[...byId.keys()]`, so every `id` here is guaranteed present in `byId`.
      const definition = byId.get(id)!;

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
      if (persisted.value.applied) applied.push(id);
    }

    return ok({ results, applied });
  }
}
