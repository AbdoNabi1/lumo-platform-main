import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { IdentityEdge } from "@platform/tracking";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { IdentitySplit } from "../events/identity-split.event";
import type { IdentityDecisionStore } from "../ports/identity-decision-store";
import type { IdentityGraphStore } from "../ports/identity-graph-store";
import { edgeKey } from "../ports/identity-resolution";

export interface SplitIdentityInput {
  /** The exact previously-observed edge being disputed — identified by its full evidence, not
   * just endpoints, so retracting a wrong observation never affects a later correct one between
   * the same two identifiers. */
  readonly edge: IdentityEdge;
  readonly reason: string;
  readonly actor: string;
}

export interface SplitIdentityOutput {
  readonly decisionId: string;
}

export interface SplitIdentityDeps {
  readonly graph: IdentityGraphStore;
  readonly decisions: IdentityDecisionStore;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Retracts one observed edge from future resolution — the append-only graph itself is never
 * edited (doc 17 §4); the retraction is recorded as a decision and `resolveIdentity` is asked to
 * exclude it (see `excludeRetractedEdges`). Used when a probabilistic stitch turns out wrong (e.g.
 * a shared family device that over-merged two people).
 */
export class SplitIdentity implements UseCase<
  SplitIdentityInput,
  SplitIdentityOutput,
  DomainError
> {
  private readonly deps: SplitIdentityDeps;

  constructor(deps: SplitIdentityDeps) {
    this.deps = deps;
  }

  async execute(input: SplitIdentityInput): Promise<Result<SplitIdentityOutput, DomainError>> {
    if (input.reason.trim() === "" || input.actor.trim() === "") {
      return err(
        new ValidationError("Split requires a reason and an actor", [
          { field: "reason", message: "required" },
        ]),
      );
    }

    // Without this, a mistyped or fabricated edge silently records a decision row that retracts
    // nothing (`excludeRetractedEdges` matches by the same key and finds no edge to exclude) — the
    // actor sees success but resolution is unchanged. `edgeKey` is order-independent, so this also
    // accepts an edge reconstructed with endpoints swapped relative to how it happens to be stored.
    const graph = await this.deps.graph.loadGraph();
    const target = edgeKey(input.edge);
    if (!graph.edges.some((observed) => edgeKey(observed) === target)) {
      return err(
        new ValidationError("Cannot split an edge that was never observed", [
          { field: "edge", message: "no matching observed edge found" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<SplitIdentityOutput, DomainError>>(async (tx) => {
      const occurredAt = this.deps.clock.now();
      const decisionId = this.deps.idGenerator.generate();
      const subject = { type: input.edge.fromType, value: input.edge.fromValue };
      const related = { type: input.edge.toType, value: input.edge.toValue };

      const event = new IdentitySplit(
        {
          eventId: this.deps.idGenerator.generate(),
          aggregateId: UniqueEntityId.from(decisionId),
          occurredAt,
        },
        {
          decisionId,
          retractedFromType: input.edge.fromType,
          retractedFromValue: input.edge.fromValue,
          retractedToType: input.edge.toType,
          retractedToValue: input.edge.toValue,
          reason: input.reason,
          actor: input.actor,
        },
      );

      await this.deps.decisions.record(
        {
          id: decisionId,
          kind: "split",
          subject,
          related,
          retractedEdge: input.edge,
          reason: input.reason,
          actor: input.actor,
          occurredAt: occurredAt.toISOString(),
        },
        event,
        tx,
      );

      return ok({ decisionId });
    });
  }
}
