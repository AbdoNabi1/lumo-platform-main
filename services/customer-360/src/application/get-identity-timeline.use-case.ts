import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { IdentifierRef } from "../ports/identity-decision";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";
import type { IdentityGraphStore } from "../ports/identity-graph-store";
import type { IdentityTimelineEntry } from "../ports/identity-timeline";

export interface GetIdentityTimelineInput {
  /** Tenant every read/write is scoped to (ADR-0014) — from the verified request context,
   * never caller-supplied data. */
  readonly tenantId: string;
  readonly identifier: IdentifierRef;
}

export interface GetIdentityTimelineOutput {
  readonly entries: readonly IdentityTimelineEntry[];
}

export interface GetIdentityTimelineDeps {
  readonly graph: IdentityGraphStore;
  readonly decisions: IdentityDecisionStore;
}

/**
 * The identity engine's own history view (distinct from the cross-domain Customer Timeline of a
 * later phase): every observed link touching this identifier, interleaved chronologically with
 * every merge/split decision that named it.
 */
export class GetIdentityTimeline implements UseCase<
  GetIdentityTimelineInput,
  GetIdentityTimelineOutput,
  DomainError
> {
  private readonly deps: GetIdentityTimelineDeps;

  constructor(deps: GetIdentityTimelineDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetIdentityTimelineInput,
  ): Promise<Result<GetIdentityTimelineOutput, DomainError>> {
    const [graph, decisions] = await Promise.all([
      this.deps.graph.loadGraph(input.tenantId),
      this.deps.decisions.listFor(input.identifier, input.tenantId),
    ]);

    const observed: IdentityTimelineEntry[] = graph.edges
      .filter(
        (edge) =>
          (edge.fromType === input.identifier.type && edge.fromValue === input.identifier.value) ||
          (edge.toType === input.identifier.type && edge.toValue === input.identifier.value),
      )
      .map((edge) => {
        const onSubjectSide =
          edge.fromType === input.identifier.type && edge.fromValue === input.identifier.value;
        return {
          kind: "observed" as const,
          occurredAt: edge.observedAt,
          counterpartType: onSubjectSide ? edge.toType : edge.fromType,
          counterpartValue: onSubjectSide ? edge.toValue : edge.fromValue,
          confidence: edge.confidence,
          source: edge.source,
        };
      });

    const decided: IdentityTimelineEntry[] = decisions.map((decision) => {
      const onSubjectSide =
        decision.subject.type === input.identifier.type &&
        decision.subject.value === input.identifier.value;
      const counterpart = onSubjectSide ? decision.related : decision.subject;
      return {
        kind: decision.kind === "merge" ? ("merged" as const) : ("split" as const),
        occurredAt: decision.occurredAt,
        decisionId: decision.id,
        counterpartType: counterpart.type,
        counterpartValue: counterpart.value,
        reason: decision.reason,
        actor: decision.actor,
      };
    });

    const entries = [...observed, ...decided].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );
    return ok({ entries });
  }
}
