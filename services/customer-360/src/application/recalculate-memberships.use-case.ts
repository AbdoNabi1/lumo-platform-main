import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { dependentsOf } from "../domain/attribute-dependency";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";
import type { SegmentEvaluationResult } from "../ports/segment-evaluation";
import {
  toSegmentDependencyEdges,
  type EvaluateAllSegments,
} from "./evaluate-all-segments.use-case";

export interface RecalculateMembershipsInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
  /**
   * Fact paths known to have changed upstream (e.g. `"profile.ltv"` after `UpdateProfileProjection`,
   * `"attributes.vip_tier"` after `UpdateComputedAttributeProjection`, `"journey.sessionCount"` after
   * a session event) — **not** segment ids; segments have no dependents of their own to chase
   * (`SEGMENTATION_MODEL.md` §5). Omitted or empty ⇒ recompute the **full** registered segment set —
   * the escape hatch for an identifier's first-ever evaluation, or a definition-catalog change wide
   * enough that the caller cannot name a precise seed. This one `changed` shape is what unifies the
   * brief's three separate incremental-update requirements ("when Profile changes," "when a Computed
   * Attribute changes," "when Session changes, only affected segments recompute") into exactly one
   * mechanism.
   */
  readonly changed?: readonly string[];
}

export interface RecalculateMembershipsOutput {
  readonly results: readonly SegmentEvaluationResult[];
  readonly applied: readonly string[];
  /** Every segment id considered this run, in registry order — the full registered set when `changed`
   * was omitted, otherwise `changed`'s dependents closure (`domain/attribute-dependency.ts`'s
   * `dependentsOf`, reused verbatim — no second dependency-graph implementation). The audit trail
   * proving an unrelated segment was never touched. */
  readonly recomputed: readonly string[];
}

export interface RecalculateMembershipsDeps {
  readonly definitions: SegmentDefinitionRegistry;
  readonly evaluateAll: EvaluateAllSegments;
}

/**
 * The incremental-recompute entry point — the Segmentation analogue of
 * `RecalculateComputedAttributes`, deliberately simpler: there is no acyclicity or
 * unregistered-dependency validation to run (both are meaningful only for a graph whose non-leaf
 * nodes can appear as another node's `dependsOn`; segments never do — `evaluate-all-segments.use-
 * case.ts`'s module doc). Loads the full registry, builds the fact→segment edges once via
 * `toSegmentDependencyEdges`, narrows to exactly the affected closure when `changed` is given via the
 * reused `dependentsOf`, and delegates evaluation + persistence of that (possibly proper) subset to
 * `EvaluateAllSegments`.
 */
export class RecalculateMemberships implements UseCase<
  RecalculateMembershipsInput,
  RecalculateMembershipsOutput,
  DomainError
> {
  private readonly deps: RecalculateMembershipsDeps;

  constructor(deps: RecalculateMembershipsDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecalculateMembershipsInput,
  ): Promise<Result<RecalculateMembershipsOutput, DomainError>> {
    const all = await this.deps.definitions.list(input.tenantId);
    const byId = new Map(all.map((definition) => [definition.id, definition]));

    const edges = toSegmentDependencyEdges(all);
    const ids = all.map((definition) => definition.id);

    const changedClosure =
      input.changed === undefined || input.changed.length === 0
        ? null
        : dependentsOf(input.changed, edges);

    // `dependentsOf`'s closure includes its own seeds — for a fact→segment graph the seeds are fact
    // paths (never segment ids themselves), so filtering `ids` against the closure correctly keeps
    // only the segments the closure actually reached, never a fact path masquerading as one.
    const recomputed = changedClosure === null ? ids : ids.filter((id) => changedClosure.has(id));

    // `recomputed` is always `ids` or a filtered subset of it, and `ids`/`byId` are built from the
    // same `all` list, so every id here is guaranteed present in `byId`.
    const scopedDefinitions = recomputed.map((id) => byId.get(id)!);

    const evaluated = await this.deps.evaluateAll.execute({
      tenantId: input.tenantId,
      identifier: input.identifier,
      definitions: scopedDefinitions,
    });
    if (!evaluated.ok) return evaluated;

    return ok({
      results: evaluated.value.results,
      applied: evaluated.value.applied,
      recomputed,
    });
  }
}
