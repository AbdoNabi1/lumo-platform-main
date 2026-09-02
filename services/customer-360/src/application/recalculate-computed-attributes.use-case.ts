import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, ValidationError, type DomainError } from "@platform/utils";
import { dependentsOf, topologicalOrder } from "../domain/attribute-dependency";
import type { AttributeEvaluationResult } from "../ports/attribute-evaluation";
import type { AttributeDefinitionRegistry } from "../ports/attribute-definition-registry";
import type { IdentifierRef } from "../ports/identity-decision";
import {
  toDependencyEdges,
  type EvaluateAttributeGraph,
} from "./evaluate-attribute-graph.use-case";

export interface RecalculateComputedAttributesInput {
  readonly identifier: IdentifierRef;
  /**
   * Attribute ids known to have changed inputs upstream (e.g. a profile field one of them reads was
   * just updated by `UpdateProfileProjection`). Omitted or empty ⇒ recompute the **full** registered
   * attribute set from scratch — the deliberate escape hatch for an identifier's first-ever
   * evaluation, or a definition-catalog change wide enough that the caller cannot name a precise
   * seed. Whenever a caller *can* name what changed, passing it here is what keeps this operation
   * proportional to the change instead of the whole graph — the brief's explicit Incremental
   * Evaluation requirement.
   */
  readonly changed?: readonly string[];
}

export interface RecalculateComputedAttributesOutput {
  readonly results: readonly AttributeEvaluationResult[];
  readonly applied: readonly string[];
  /** Every attribute id considered this run, in evaluation order — the full registered set when
   * `changed` was omitted, otherwise `changed`'s transitive-dependents closure
   * (`domain/attribute-dependency.ts`'s `dependentsOf`). This is the audit trail proving an unrelated
   * attribute was never touched: a caller (or a test) can assert `recomputed` excludes attributes
   * with no path from `changed`. */
  readonly recomputed: readonly string[];
}

export interface RecalculateComputedAttributesDeps {
  readonly definitions: AttributeDefinitionRegistry;
  readonly evaluateGraph: EvaluateAttributeGraph;
}

/**
 * The incremental-recompute entry point — the Phase 6.4 brief's central requirement: "if one
 * attribute changes, do not recompute everyone; recompute dependents only." Loads the **full**
 * registered graph (needed to validate the whole thing is acyclic and to compute a correct
 * transitive-dependents closure — a cycle anywhere in the registry is a real configuration error
 * worth surfacing immediately, even when this particular run's own scope would not have reached it),
 * narrows to exactly the affected closure when `changed` is given, and delegates ordered
 * evaluation + persistence of that (possibly proper) subset to `EvaluateAttributeGraph`.
 *
 * Deliberately simple over "maximally lazy": the affected closure is computed once, up front, from
 * the dependency *declarations* — not expanded incrementally as evaluations turn out to actually
 * change a value. This can evaluate a few more attributes than the absolute minimum fixpoint would
 * (a dependent whose own inputs did not end up changing still gets re-evaluated), but never anything
 * outside the true dependents closure, and `applyAttributeUpdate`'s no-op guard makes the extra work
 * cheap (no snapshot, no cache write, no event, no cascade) rather than merely harmless. A
 * lazily-expanding fixpoint would save a handful of rule evaluations at the cost of a second,
 * evaluation-order-dependent algorithm; not attempted here — see the Phase 6.4 report's deferred-work
 * section.
 */
export class RecalculateComputedAttributes implements UseCase<
  RecalculateComputedAttributesInput,
  RecalculateComputedAttributesOutput,
  DomainError
> {
  private readonly deps: RecalculateComputedAttributesDeps;

  constructor(deps: RecalculateComputedAttributesDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecalculateComputedAttributesInput,
  ): Promise<Result<RecalculateComputedAttributesOutput, DomainError>> {
    const all = await this.deps.definitions.list();
    const byId = new Map(all.map((definition) => [definition.id, definition]));

    for (const definition of all) {
      for (const dependsOn of definition.dependencies) {
        if (!byId.has(dependsOn)) {
          return err(
            new ValidationError(
              `Computed attribute "${definition.id}" depends on unregistered attribute "${dependsOn}"`,
              [{ field: "dependencies", message: `unknown dependency: ${dependsOn}` }],
            ),
          );
        }
      }
    }

    const edges = toDependencyEdges(all);
    const names = all.map((definition) => definition.id);
    const fullOrder = topologicalOrder(names, edges);
    if (!fullOrder.ok) {
      return err(
        new BusinessRuleError(
          `Computed attribute dependency cycle detected: ${fullOrder.error.cycle.join(" -> ")}`,
          { context: { cycle: fullOrder.error.cycle } },
        ),
      );
    }

    // `dependentsOf` is O(V+E) — computed once here, never inside the `.filter` predicate below,
    // which would otherwise re-run the full BFS closure once per element of `fullOrder.order`
    // (an accidental O(V+E) * O(V) blowup found and fixed during Phase 6.4.1 hardening; see
    // SPRINT_6_4_1_HARDENING_REPORT.md — this restores the "computed once, up front" behavior this
    // module doc above already claimed).
    const changedClosure =
      input.changed === undefined || input.changed.length === 0
        ? null
        : dependentsOf(input.changed, edges);

    const recomputed =
      changedClosure === null
        ? fullOrder.order
        : fullOrder.order.filter((id) => changedClosure.has(id));

    // `recomputed` is always `fullOrder.order` or a filtered subset of it, and `fullOrder.order` is
    // a permutation of `names` = `[...byId.keys()]`, so every id here is guaranteed present in `byId`.
    const scopedDefinitions = recomputed.map((id) => byId.get(id)!);

    const graphResult = await this.deps.evaluateGraph.execute({
      identifier: input.identifier,
      definitions: scopedDefinitions,
    });
    if (!graphResult.ok) return graphResult;

    return ok({
      results: graphResult.value.results,
      applied: graphResult.value.applied,
      recomputed,
    });
  }
}
